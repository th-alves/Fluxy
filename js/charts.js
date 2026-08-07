/* ============================================
   CHARTS MODULE — Canvas Donut & Budget Bars
   ============================================ */
const Charts = (() => {

    const CATEGORY_COLORS = {
        'contas':      '#c4864a',
        'parcela':     '#98a1ae',
        'assinatura':  '#6fa89f',
        'fatura':      '#9b7fb5',
        'futuro':      '#6e93bf',
        'compras':     '#c4708a'
    };

    const CATEGORY_LABELS = {
        'contas':      'Contas',
        'parcela':     'Parcela',
        'assinatura':  'Assinatura',
        'fatura':      'Fatura',
        'futuro':      'Futuro',
        'compras':     'Compras'
    };

    let _donutRAF = null;
    let _trendRAF = null;

    /* ---- helpers ---- */
    function fmt(v) {
        return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    }
    function easeOut(t) { return 1 - Math.pow(1 - t, 3); }

    /* =========== DONUT CHART =========== */
    function renderDonut(canvas, categoryBreakdown, totalSpent) {
        if (!canvas) return;
        const ctx  = canvas.getContext('2d');
        const dpr  = window.devicePixelRatio || 1;
        const rect = canvas.parentElement.getBoundingClientRect();
        const size = Math.min(rect.width - 40, 260);

        canvas.width  = size * dpr;
        canvas.height = size * dpr;
        canvas.style.width  = size + 'px';
        canvas.style.height = size + 'px';
        ctx.scale(dpr, dpr);

        const cx = size / 2, cy = size / 2;
        const rOuter = size / 2 - 8;
        const rInner = rOuter * 0.62;
        const gap    = 0.03;                    // radians gap between slices

        const cats = Object.keys(categoryBreakdown).filter(k => categoryBreakdown[k] > 0);

        /* empty state */
        if (cats.length === 0 || totalSpent === 0) {
            ctx.clearRect(0, 0, size, size);
            ctx.beginPath();
            ctx.arc(cx, cy, rOuter, 0, Math.PI * 2);
            ctx.arc(cx, cy, rInner, 0, Math.PI * 2, true);
            ctx.fillStyle = 'rgba(243,239,230,0.04)';
            ctx.fill();
            ctx.fillStyle = 'rgba(243,239,230,0.25)';
            ctx.font = '600 14px "Inter", sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('Sem gastos', cx, cy);
            return;
        }

        if (_donutRAF) cancelAnimationFrame(_donutRAF);

        const t0 = performance.now();
        const dur = 900;

        (function frame(now) {
            const p = Math.min((now - t0) / dur, 1);
            const e = easeOut(p);

            ctx.clearRect(0, 0, size, size);

            let angle = -Math.PI / 2;
            cats.forEach(cat => {
                const ratio = categoryBreakdown[cat] / totalSpent;
                const sweep = ratio * Math.PI * 2 * e;
                if (sweep <= 0) return;

                ctx.beginPath();
                ctx.arc(cx, cy, rOuter, angle + gap / 2, angle + sweep - gap / 2);
                ctx.arc(cx, cy, rInner, angle + sweep - gap / 2, angle + gap / 2, true);
                ctx.closePath();
                ctx.fillStyle = CATEGORY_COLORS[cat] || '#6b7280';
                ctx.fill();

                angle += sweep;
            });

            /* centre label */
            ctx.fillStyle = '#f3efe6';
            ctx.font = '600 19px "IBM Plex Mono", monospace';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(fmt(totalSpent * e), cx, cy - 10);
            ctx.fillStyle = 'rgba(243,239,230,0.5)';
            ctx.font = '500 11px "Inter", sans-serif';
            ctx.fillText('Total Gasto', cx, cy + 12);

            if (p < 1) _donutRAF = requestAnimationFrame(frame);
        })(t0);
    }

    /* =========== LEGEND =========== */
    function renderLegend(container, categoryBreakdown, totalSpent) {
        if (!container) return;
        container.innerHTML = '';

        const cats = Object.keys(categoryBreakdown).filter(k => categoryBreakdown[k] > 0);
        if (cats.length === 0) {
            container.innerHTML = '<p class="legend-empty">Nenhuma categoria registrada</p>';
            return;
        }

        cats.sort((a, b) => categoryBreakdown[b] - categoryBreakdown[a])
            .forEach(cat => {
                const v = categoryBreakdown[cat];
                const pct = totalSpent > 0 ? ((v / totalSpent) * 100).toFixed(1) : '0.0';
                const el = document.createElement('div');
                el.className = 'legend-item';
                el.innerHTML = `
                    <span class="legend-color" style="background:${CATEGORY_COLORS[cat] || '#6b7280'}"></span>
                    <span class="legend-label">${CATEGORY_LABELS[cat] || cat}</span>
                    <span class="legend-value">${fmt(v)}</span>
                    <span class="legend-pct">${pct}%</span>`;
                container.appendChild(el);
            });
    }

    /* =========== BUDGET BARS (faixas editáveis) =========== */
    function renderBudgetBars(container, totals) {
        if (!container) return;

        const bars = [
            { key: 'essencial',       label: 'Essencial',       sub: `${totals.essentialPct}%`,  icon: '🏠', spent: totals.essentialSpent,  budget: totals.essentialBudget,  color: '#c4864a', grad: 'linear-gradient(90deg,#c4864a,#e3a53d)' },
            { key: 'estilo-de-vida',  label: 'Estilo de Vida',  sub: `${totals.lifestylePct}%`,  icon: '🎯', spent: totals.lifestyleSpent,  budget: totals.lifestyleBudget,  color: '#9b7fb5', grad: 'linear-gradient(90deg,#9b7fb5,#b79bcb)' },
            { key: 'investimento',    label: 'Investimento',    sub: `${totals.investmentPct}%`, icon: '📈', spent: totals.investmentSpent, budget: totals.investmentBudget, color: '#4fb286', grad: 'linear-gradient(90deg,#4fb286,#7bd1a8)' }
        ];

        container.innerHTML = bars.map(b => {
            const pct  = b.budget > 0 ? Math.min((b.spent / b.budget) * 100, 150) : 0;
            const over = b.spent > b.budget;
            const usedPct = b.budget > 0 ? ((b.spent / b.budget) * 100).toFixed(0) : '0';

            return `
            <div class="budget-item" data-budget-key="${b.key}">
                <div class="budget-header">
                    <div class="budget-title">
                        <span class="budget-dot" style="background:${b.color}"></span>
                        <span>${b.icon} ${b.label}</span>
                        <span class="budget-sub">${b.sub}</span>
                    </div>
                    <div class="budget-vals">
                        <span class="${over ? 'over' : ''}">${fmt(b.spent)}</span>
                        <span class="budget-sep">/</span>
                        <span class="budget-total">${fmt(b.budget)}</span>
                    </div>
                </div>
                <div class="budget-track">
                    <div class="budget-fill ${over ? 'over' : ''}"
                         style="--tw:${Math.min(pct, 100)}%; background:${over ? 'linear-gradient(90deg,#c4573f,#e28368)' : b.grad}"></div>
                </div>
                <div class="budget-footer">
                    <span class="${over ? 'over' : ''}">${usedPct}% utilizado</span>
                    <span>${over ? '⚠ Excedido!' : 'Restam ' + fmt(b.budget - b.spent)}</span>
                </div>
            </div>`;
        }).join('');

        /* kick animation */
        requestAnimationFrame(() => {
            container.querySelectorAll('.budget-fill').forEach(el => {
                el.style.width = el.style.getPropertyValue('--tw');
            });
        });
    }

    /* =========== TREND CHART (últimos meses) ===========
       Área + linha suave animada mostrando a evolução do saldo mês a
       mês. Meses sem nenhum lançamento entram como 0 — mantém sempre
       o mesmo número de pontos (mais previsível que "pular" meses
       vazios) e ainda deixa claro visualmente que não teve movimento. */
    function renderTrend(canvas, values) {
        if (!canvas) return;
        const ctx  = canvas.getContext('2d');
        const dpr  = window.devicePixelRatio || 1;
        const rect = canvas.parentElement.getBoundingClientRect();
        const w = rect.width;
        const h = 150;

        canvas.width  = w * dpr;
        canvas.height = h * dpr;
        canvas.style.width  = w + 'px';
        canvas.style.height = h + 'px';
        ctx.scale(dpr, dpr);

        if (!values || values.length < 2) {
            ctx.clearRect(0, 0, w, h);
            return;
        }

        const padX = 6, padTop = 18, padBottom = 10;
        const min = Math.min(0, ...values);
        const max = Math.max(...values, 1);
        const span = (max - min) || 1;
        const usableW = w - padX * 2;
        const usableH = h - padTop - padBottom;
        const stepX = usableW / (values.length - 1);

        const xy = values.map((v, i) => [
            padX + i * stepX,
            padTop + usableH - ((v - min) / span) * usableH
        ]);
        const zeroY = padTop + usableH - ((0 - min) / span) * usableH;

        if (_trendRAF) cancelAnimationFrame(_trendRAF);
        const t0 = performance.now();
        const dur = 900;

        (function frame(now) {
            const p = Math.min((now - t0) / dur, 1);
            const e = easeOut(p);
            const visibleCount = Math.max(2, Math.ceil(xy.length * e));
            const visible = xy.slice(0, visibleCount);

            ctx.clearRect(0, 0, w, h);

            /* linha do zero, discreta */
            ctx.strokeStyle = 'rgba(243,239,230,0.08)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(padX, zeroY);
            ctx.lineTo(w - padX, zeroY);
            ctx.stroke();

            /* área preenchida com degradê */
            const grad = ctx.createLinearGradient(0, padTop, 0, h);
            grad.addColorStop(0, 'rgba(227,165,61,0.28)');
            grad.addColorStop(1, 'rgba(227,165,61,0)');
            ctx.beginPath();
            ctx.moveTo(visible[0][0], zeroY);
            visible.forEach(([x, y]) => ctx.lineTo(x, y));
            ctx.lineTo(visible[visible.length - 1][0], zeroY);
            ctx.closePath();
            ctx.fillStyle = grad;
            ctx.fill();

            /* linha */
            ctx.beginPath();
            visible.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
            ctx.strokeStyle = '#ffcf7a';
            ctx.lineWidth = 2.4;
            ctx.lineJoin = 'round';
            ctx.lineCap = 'round';
            ctx.stroke();

            /* pontinhos, com o último em destaque */
            visible.forEach(([x, y], i) => {
                ctx.beginPath();
                ctx.arc(x, y, i === visible.length - 1 ? 3.6 : 2.2, 0, Math.PI * 2);
                ctx.fillStyle = '#ffcf7a';
                ctx.fill();
            });

            if (p < 1) _trendRAF = requestAnimationFrame(frame);
        })(t0);
    }

    return { renderDonut, renderLegend, renderBudgetBars, renderTrend, CATEGORY_COLORS, CATEGORY_LABELS };
})();
