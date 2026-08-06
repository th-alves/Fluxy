/* ============================================
   APP MODULE — Main Orchestrator
   ============================================ */
const App = (() => {

    /* ---------- State ---------- */
    let currentMonthKey = Storage.getCurrentMonthKey();
    let currentMonthData = { salaries: [], transactions: [] }; // cache do mês atual (evita refetch a cada clique)
    let editingTransactionId = null;
    let deletingType = null;   // 'transaction' | 'salary'
    let deletingId = null;
    let filterCategory = '';
    let filterStatus = '';

    /* ---------- Label maps ---------- */
    const CATEGORY_LABELS = {
        'contas': 'Contas', 'parcela': 'Parcela', 'assinatura': 'Assinatura',
        'fatura': 'Fatura', 'futuro': 'Futuro', 'compras': 'Compras'
    };

    const PAYMENT_LABELS = {
        'pix': 'Pix', 'conta-corrente': 'Conta Corrente',
        'cartao-credito': 'Cartão de Crédito', 'cartao-debito': 'Cartão de Débito',
        'dinheiro': 'Dinheiro', 'boleto': 'Boleto'
    };

    const PAYMENT_ICONS = {
        'pix': '⚡', 'conta-corrente': '🏦', 'cartao-credito': '💳',
        'cartao-debito': '💳', 'dinheiro': '💵', 'boleto': '📄'
    };

    const CLASS_LABELS = {
        'essencial': 'Essencial (50%)', 'estilo-de-vida': 'Estilo de Vida (30%)',
        'investimento': 'Investimento (20%)'
    };

    /* ---------- DOM refs ---------- */
    const $ = id => document.getElementById(id);

    /* ---------- Helpers ---------- */
    function fmt(v) {
        return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    }

    function formatDate(dateStr) {
        if (!dateStr) return '—';
        const [y, m, d] = dateStr.split('-');
        return `${d}/${m}/${y}`;
    }

    /* ---------- Currency Mask ---------- */
    function setupCurrencyMask(input) {
        input.addEventListener('input', function () {
            let digits = this.value.replace(/\D/g, '');
            if (digits === '') { this.value = ''; return; }
            /* Remove leading zeros but keep at least 1 */
            digits = digits.replace(/^0+/, '') || '0';
            const cents = parseInt(digits, 10);
            const formatted = (cents / 100).toLocaleString('pt-BR', {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2
            });
            this.value = formatted;
        });

        /* Select all on focus for easy overwrite */
        input.addEventListener('focus', function () {
            setTimeout(() => this.select(), 0);
        });
    }

    function parseCurrency(str) {
        if (!str) return 0;
        /* "1.500,75" → "1500.75" */
        const cleaned = str.replace(/\./g, '').replace(',', '.');
        return parseFloat(cleaned) || 0;
    }

    function formatToCurrencyString(num) {
        return Math.abs(num).toLocaleString('pt-BR', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        });
    }

    /* ---------- Toast ---------- */
    function toast(message, type = 'success') {
        const icons = { success: '✅', error: '❌', info: 'ℹ️' };
        const container = $('toast-container');
        const el = document.createElement('div');
        el.className = `toast ${type}`;
        el.innerHTML = `<span class="toast-icon">${icons[type] || '✅'}</span><span>${message}</span>`;
        container.appendChild(el);
        setTimeout(() => {
            el.classList.add('hiding');
            setTimeout(() => el.remove(), 300);
        }, 3000);
    }

    /* ---------- Modal helpers ---------- */
    function openModal(id) {
        $(id).classList.add('active');
        document.body.style.overflow = 'hidden';
    }

    function closeModal(id) {
        $(id).classList.remove('active');
        document.body.style.overflow = '';
    }

    function closeAllModals() {
        document.querySelectorAll('.modal-overlay').forEach(m => m.classList.remove('active'));
        document.body.style.overflow = '';
    }

    /* ============================
       RENDER — Summary Cards
       ============================ */
    function renderSummary(totals) {
        animateValue($('card-income'), totals.totalIncome);
        animateValue($('card-spent'), totals.totalSpent);
        animateValue($('card-remaining'), totals.remaining);
        animateValue($('card-pending'), totals.totalPending);
    }

    function animateValue(el, target) {
        const duration = 700;
        const start = performance.now();
        const from = parseFloat(el.dataset.current || '0');
        el.dataset.current = target;

        (function tick(now) {
            const p = Math.min((now - start) / duration, 1);
            const eased = 1 - Math.pow(1 - p, 3);
            const v = from + (target - from) * eased;
            el.textContent = fmt(v);
            if (p < 1) requestAnimationFrame(tick);
            else el.textContent = fmt(target);
        })(start);
    }

    /* ============================
       RENDER — Salary List
       ============================ */
    function renderSalaries(monthData) {
        const list = $('salary-list');

        if (monthData.salaries.length === 0) {
            list.innerHTML = `
                <div class="salary-empty">
                    <span class="empty-icon">💵</span>
                    Nenhum salário adicionado.<br>
                    <small style="color:var(--text-muted)">Adicione sua renda para começar a controlar seus gastos.</small>
                </div>`;
            return;
        }

        list.innerHTML = monthData.salaries.map(s => `
            <div class="salary-entry" data-id="${s.id}">
                <div class="salary-icon">💵</div>
                <div class="salary-info">
                    <div class="salary-desc">${s.description || 'Salário'}</div>
                    <div class="salary-day">Dia ${s.day || '—'} de cada mês</div>
                </div>
                <div class="salary-value">${fmt(parseFloat(s.value) || 0)}</div>
                <button class="btn-icon delete" data-delete-salary="${s.id}" title="Remover">🗑️</button>
            </div>
        `).join('');
    }

    /* ============================
       RENDER — Transactions Table
       ============================ */
    function renderTransactions(monthData) {
        const tbody = $('transactions-body');
        const empty = $('empty-state');
        const table = $('data-table');

        let txs = [...monthData.transactions];

        /* Apply filters */
        if (filterCategory) txs = txs.filter(t => t.category === filterCategory);
        if (filterStatus) txs = txs.filter(t => t.status === filterStatus);

        /* Sort by date */
        txs.sort((a, b) => (a.date || '').localeCompare(b.date || ''));

        if (txs.length === 0) {
            table.style.display = 'none';
            empty.style.display = 'block';
            return;
        }

        table.style.display = '';
        empty.style.display = 'none';

        tbody.innerHTML = txs.map((t, i) => {
            const val = Math.abs(parseFloat(t.value) || 0);
            return `
            <tr data-id="${t.id}">
                <td data-label="Data">${formatDate(t.date)}</td>
                <td data-label="Categoria"><span class="category-badge ${t.category}">${CATEGORY_LABELS[t.category] || t.category}</span></td>
                <td data-label="Descrição">${t.description || '—'}</td>
                <td data-label="Pagamento">
                    <span class="payment-badge">
                        <span class="pay-icon">${PAYMENT_ICONS[t.paymentMethod] || '💳'}</span>
                        ${PAYMENT_LABELS[t.paymentMethod] || t.paymentMethod}
                    </span>
                </td>
                <td data-label="Classificação"><span class="class-badge ${t.classification}">${CLASS_LABELS[t.classification] || t.classification}</span></td>
                <td data-label="Valor"><span class="value-display value-negative">- ${fmt(val)}</span></td>
                <td data-label="Status">
                    <span class="status-toggle" data-toggle-status="${t.id}" title="Clique para alternar">
                        <span class="status-dot ${t.status}"></span>
                        <span class="status-label ${t.status}">${t.status === 'pago' ? 'Pago' : 'Pendente'}</span>
                    </span>
                </td>
                <td>
                    <div class="row-actions">
                        <button class="btn-icon" data-edit="${t.id}" title="Editar">✏️</button>
                        <button class="btn-icon delete" data-delete-tx="${t.id}" title="Excluir">🗑️</button>
                    </div>
                </td>
            </tr>`;
        }).join('');
    }

    /* ============================
       RENDER — Month progress bar
       Shows how much of the selected month has elapsed. Past months
       read as full, future months as empty, current month tracks
       today's date.
       ============================ */
    function renderMonthProgress(monthKey) {
        const fill = $('month-progress-fill');
        if (!fill) return;

        const { year, month } = Storage.parseMonthKey(monthKey);
        const today = new Date();
        const daysInMonth = new Date(year, month + 1, 0).getDate();

        let pct;
        if (year === today.getFullYear() && month === today.getMonth()) {
            pct = (today.getDate() / daysInMonth) * 100;
        } else {
            const isPast = year < today.getFullYear() ||
                (year === today.getFullYear() && month < today.getMonth());
            pct = isPast ? 100 : 0;
        }

        fill.style.width = `${Math.min(100, Math.max(0, pct))}%`;
    }

    /* ============================
       RENDER — Trend sparklines
       Pulls the 6 months up to and including the selected one and
       draws a quiet line + endpoint dot per metric. Months with no
       data at all are skipped so an empty history doesn't render as
       a flat zero line.
       ============================ */
    function buildSparklinePoints(values) {
        if (values.length < 2) return null;

        const min = Math.min(...values);
        const max = Math.max(...values);
        const span = max - min || 1;
        const stepX = 100 / (values.length - 1);
        const padY = 3;
        const usableH = 24 - padY * 2;

        return values.map((v, i) => {
            const x = i * stepX;
            const y = padY + usableH - ((v - min) / span) * usableH;
            return [x, y];
        });
    }

    function paintSparkline(svgId, points) {
        const svg = $(svgId);
        if (!svg) return;

        if (!points) {
            svg.innerHTML = '';
            return;
        }

        const linePoints = points.map(p => p.join(',')).join(' ');
        const [lastX, lastY] = points[points.length - 1];
        svg.innerHTML = `
            <polyline points="${linePoints}"></polyline>
            <circle cx="${lastX}" cy="${lastY}" r="2.4"></circle>
        `;
    }

    async function renderSparklines(monthKey) {
        /* Walk 6 months back (including current) */
        const keys = [];
        let k = monthKey;
        for (let i = 0; i < 6; i++) {
            keys.unshift(k);
            k = Storage.navigateMonth(k, -1);
        }

        const allData = (await Storage.getAllData()).months || {};
        const series = keys
            .filter(key => allData[key])
            .map(key => Storage.calculateTotals(allData[key]));

        const incomeVals = series.map(t => t.totalIncome);
        const spentVals = series.map(t => t.totalSpent);
        const remainingVals = series.map(t => t.remaining);

        paintSparkline('spark-income', buildSparklinePoints(incomeVals));
        paintSparkline('spark-spent', buildSparklinePoints(spentVals));
        paintSparkline('spark-remaining', buildSparklinePoints(remainingVals));
    }

    /* ============================
       RENDER — Full refresh
       ============================ */
    async function renderAll() {
        const monthData = await Storage.getMonthData(currentMonthKey);
        currentMonthData = monthData;
        const totals = Storage.calculateTotals(monthData);

        /* Month display */
        $('month-display').textContent = Storage.getMonthName(currentMonthKey);
        renderMonthProgress(currentMonthKey);

        /* Cards */
        renderSummary(totals);
        await renderSparklines(currentMonthKey);

        /* Charts */
        Charts.renderDonut($('chart-donut'), totals.categoryBreakdown, totals.totalSpent);
        Charts.renderLegend($('chart-legend'), totals.categoryBreakdown, totals.totalSpent);
        Charts.renderBudgetBars($('budget-bars'), totals);

        /* Salaries */
        renderSalaries(monthData);

        /* Transactions */
        renderTransactions(monthData);
    }

    /* ============================
       EVENT HANDLERS
       ============================ */

    /* -- Month navigation with slide animation -- */
    function animateMonthChange(direction) {
        const display = $('month-display');
        const cards = $('summary-cards');

        /* Slide out */
        display.style.transition = 'opacity 0.15s, transform 0.15s';
        display.style.opacity = '0';
        display.style.transform = `translateX(${direction * -20}px)`;

        setTimeout(async () => {
            currentMonthKey = Storage.navigateMonth(currentMonthKey, direction);
            await renderAll();

            /* Slide in from opposite side */
            display.style.transform = `translateX(${direction * 20}px)`;
            requestAnimationFrame(() => {
                display.style.opacity = '1';
                display.style.transform = 'translateX(0)';
            });
        }, 150);
    }

    function onPrevMonth() { animateMonthChange(-1); }
    function onNextMonth() { animateMonthChange(1); }

    /* -- Salary modal -- */
    function onAddSalary() {
        $('salary-form').reset();
        openModal('salary-modal');
    }

    async function onSalarySubmit(e) {
        e.preventDefault();
        const desc = $('salary-description').value.trim();
        const val  = parseCurrency($('salary-value').value);
        const day  = $('salary-day').value;

        if (!desc || !val || !day) return;

        await Storage.addSalary(currentMonthKey, {
            description: desc,
            value: val,
            day: parseInt(day)
        });

        closeModal('salary-modal');
        toast('Renda adicionada com sucesso!');
        await renderAll();
    }

    /* -- Transaction modal -- */
    function onAddTransaction() {
        editingTransactionId = null;
        $('modal-title').textContent = 'Nova Transação';
        $('modal-save-tx').textContent = 'Salvar';
        $('transaction-form').reset();

        /* Default date to today */
        const today = new Date();
        $('field-date').value = today.toISOString().split('T')[0];

        openModal('transaction-modal');
    }

    function onEditTransaction(txId) {
        const tx = currentMonthData.transactions.find(t => t.id === txId);
        if (!tx) return;

        editingTransactionId = txId;
        $('modal-title').textContent = 'Editar Transação';
        $('modal-save-tx').textContent = 'Atualizar';

        $('field-date').value = tx.date || '';
        $('field-category').value = tx.category || 'contas';
        $('field-description').value = tx.description || '';
        $('field-payment').value = tx.paymentMethod || 'pix';
        $('field-classification').value = tx.classification || 'essencial';
        $('field-value').value = formatToCurrencyString(parseFloat(tx.value) || 0);
        $('field-status').value = tx.status || 'pendente';

        openModal('transaction-modal');
    }

    async function onTransactionSubmit(e) {
        e.preventDefault();

        const data = {
            date:           $('field-date').value,
            category:       $('field-category').value,
            description:    $('field-description').value.trim(),
            paymentMethod:  $('field-payment').value,
            classification: $('field-classification').value,
            value:          parseCurrency($('field-value').value),
            status:         $('field-status').value
        };

        if (editingTransactionId) {
            await Storage.updateTransaction(currentMonthKey, editingTransactionId, data);
            toast('Transação atualizada!');
        } else {
            await Storage.addTransaction(currentMonthKey, data);
            toast('Transação adicionada!');
        }

        closeModal('transaction-modal');
        editingTransactionId = null;
        await renderAll();
    }

    /* -- Status toggle with visual feedback -- */
    async function onToggleStatus(txId) {
        const tx = currentMonthData.transactions.find(t => t.id === txId);
        if (!tx) return;

        /* Add visual pulse on the row */
        const row = document.querySelector(`tr[data-id="${txId}"]`);
        if (row) {
            row.style.transition = 'background 0.3s';
            row.style.background = tx.status === 'pago'
                ? 'rgba(245, 158, 11, 0.08)'
                : 'rgba(34, 197, 94, 0.08)';
            setTimeout(() => { row.style.background = ''; }, 600);
        }

        const newStatus = tx.status === 'pago' ? 'pendente' : 'pago';
        await Storage.updateTransaction(currentMonthKey, txId, { status: newStatus });
        toast(newStatus === 'pago' ? 'Marcado como pago ✅' : 'Marcado como pendente ⏳', 'info');
        await renderAll();
    }

    /* -- Delete flow -- */
    function onRequestDelete(type, id) {
        deletingType = type;
        deletingId = id;
        openModal('delete-modal');
    }

    async function onConfirmDelete() {
        if (deletingType === 'transaction' && deletingId) {
            await Storage.deleteTransaction(currentMonthKey, deletingId);
            toast('Transação excluída!', 'info');
        } else if (deletingType === 'salary' && deletingId) {
            await Storage.deleteSalary(currentMonthKey, deletingId);
            toast('Renda removida!', 'info');
        }
        deletingType = null;
        deletingId = null;
        closeModal('delete-modal');
        await renderAll();
    }

    /* -- Filters -- */
    function onFilterChange() {
        filterCategory = $('filter-category').value;
        filterStatus = $('filter-status').value;
        renderTransactions(currentMonthData);
    }

    /* -- Export -- */
    function onDownload() {
        const monthData = currentMonthData;
        if (monthData.salaries.length === 0 && monthData.transactions.length === 0) {
            toast('Nenhum dado para exportar neste mês.', 'error');
            return;
        }
        ExportModule.downloadSpreadsheet(monthData, currentMonthKey);
        toast('Planilha exportada com sucesso! 📥');
    }

    /* -- Import -- */
    function onImportClick() {
        $('import-file-input').click();
    }

    async function onImportFileSelected(e) {
        const file = e.target.files[0];
        e.target.value = '';
        if (!file) return;

        try {
            const groups = await ImportModule.handleFile(file, currentMonthKey);

            if (!groups || groups.length === 0) {
                toast('Nenhum dado encontrado na planilha. Verifique o formato.', 'error');
                return;
            }

            /* Totais globais */
            const totalTx  = groups.reduce((s, g) => s + g.transactions.length, 0);
            const totalSal = groups.reduce((s, g) => s + g.salaries.length, 0);
            $('import-tx-count').textContent  = totalTx;
            $('import-sal-count').textContent = totalSal;

            const sheetsSection = $('import-sheets-section');
            const monthSection  = $('import-month-section');
            const sheetsList    = $('import-sheets-list');

            /* Múltiplas abas com mês detectado → mostra lista de abas */
            if (groups.length > 1 || (groups.length === 1 && groups[0].detectedMonthKey)) {
                sheetsSection.style.display = 'block';
                monthSection.style.display  = 'none';

                sheetsList.innerHTML = groups.map(g => `
                    <div class="import-sheet-row">
                        <div class="import-sheet-info">
                            <span class="import-sheet-name">${g.sheetName}</span>
                            <span class="import-sheet-month">${g.detectedMonthKey ? Storage.getMonthName(g.detectedMonthKey) : '—'}</span>
                        </div>
                        <div class="import-sheet-counts">
                            <span>${g.transactions.length} transações</span>
                            ${g.salaries.length > 0 ? `<span>${g.salaries.length} renda(s)</span>` : ''}
                        </div>
                    </div>
                `).join('');

            } else {
                /* Aba única sem mês detectado → mostra selector de mês */
                sheetsSection.style.display = 'none';
                monthSection.style.display  = 'block';

                const select = $('import-month-select');
                select.innerHTML = '';
                let pivot = currentMonthKey;
                for (let i = 12; i > 0; i--) pivot = Storage.navigateMonth(pivot, -1);
                const monthKeys = [];
                for (let i = 0; i < 25; i++) {
                    monthKeys.push(pivot);
                    pivot = Storage.navigateMonth(pivot, 1);
                }
                if (!monthKeys.includes(currentMonthKey)) monthKeys.push(currentMonthKey);
                monthKeys.sort();
                monthKeys.forEach(key => {
                    const opt = document.createElement('option');
                    opt.value = key;
                    opt.textContent = Storage.getMonthName(key);
                    if (key === currentMonthKey) opt.selected = true;
                    select.appendChild(opt);
                });
            }

            /* Reseta modo */
            const addRadio = document.querySelector('input[name="import-mode"][value="add"]');
            if (addRadio) addRadio.checked = true;

            openModal('import-modal');

        } catch (err) {
            console.error('Erro ao importar planilha:', err);
            toast('Erro ao processar o arquivo. Verifique se é um .xlsx ou .csv válido.', 'error');
        }
    }

    async function onImportConfirm() {
        const mode = document.querySelector('input[name="import-mode"]:checked').value;

        /* Se no modo mês único (fallback), ajusta o monthKey do grupo */
        const monthSection = $('import-month-section');
        if (monthSection.style.display !== 'none') {
            ImportModule.overrideSingleMonthKey($('import-month-select').value);
        }

        /* Captura o mês da primeira aba ANTES de confirmImport limpar _pending */
        const navigateTo = ImportModule.getFirstMonthKey() || currentMonthKey;

        const success = await ImportModule.confirmImport(mode);
        if (!success) {
            toast('Nenhum dado para importar.', 'error');
            return;
        }

        closeModal('import-modal');
        currentMonthKey = navigateTo;
        await renderAll();
        toast('Dados importados com sucesso! 📤');
    }

    function onImportCancel() {
        ImportModule.clearPending();
        closeModal('import-modal');
    }

    /* -- Copy from last month -- */
    async function onCopyFromLastMonth() {
        const prevMonthKey = Storage.navigateMonth(currentMonthKey, -1);
        const prevData = await Storage.getMonthData(prevMonthKey);

        if (prevData.transactions.length === 0) {
            toast(`Nenhuma transação encontrada em ${Storage.getMonthName(prevMonthKey)}.`, 'error');
            return;
        }

        const currentData = currentMonthData;
        let copied = 0;

        for (const tx of prevData.transactions) {
            /* Check for duplicates by description + category + value */
            const alreadyExists = currentData.transactions.some(
                t => t.description === tx.description
                  && t.category === tx.category
                  && Math.abs(parseFloat(t.value)) === Math.abs(parseFloat(tx.value))
            );
            if (alreadyExists) continue;

            /* Copy with new ID, same date adjusted to current month, status reset to pendente */
            const { year, month } = Storage.parseMonthKey(currentMonthKey);
            let newDate = tx.date;
            if (newDate) {
                const day = newDate.split('-')[2];
                newDate = `${year}-${String(month + 1).padStart(2, '0')}-${day}`;
            }

            await Storage.addTransaction(currentMonthKey, {
                date: newDate,
                category: tx.category,
                description: tx.description,
                paymentMethod: tx.paymentMethod,
                classification: tx.classification,
                value: parseFloat(tx.value) || 0,
                status: 'pendente'
            });
            copied++;
        }

        if (copied === 0) {
            toast('Todas as transações já existem neste mês.', 'info');
        } else {
            toast(`${copied} transação(s) copiada(s) de ${Storage.getMonthName(prevMonthKey)}! ✅`);
        }

        await renderAll();
    }

    /* ============================
       EVENT DELEGATION
       ============================ */
    function setupDelegation() {
        /* Transactions table & salary list — click delegation */
        document.addEventListener('click', (e) => {
            const target = e.target.closest('[data-toggle-status]');
            if (target) {
                onToggleStatus(target.dataset.toggleStatus);
                return;
            }

            const editBtn = e.target.closest('[data-edit]');
            if (editBtn) {
                onEditTransaction(editBtn.dataset.edit);
                return;
            }

            const delTx = e.target.closest('[data-delete-tx]');
            if (delTx) {
                onRequestDelete('transaction', delTx.dataset.deleteTx);
                return;
            }

            const delSal = e.target.closest('[data-delete-salary]');
            if (delSal) {
                onRequestDelete('salary', delSal.dataset.deleteSalary);
                return;
            }
        });

        /* Close modals on overlay click */
        document.querySelectorAll('.modal-overlay').forEach(modal => {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) closeModal(modal.id);
            });
        });

        /* Escape to close modals */
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') closeAllModals();
        });
    }

    /* ============================
       INIT
       ============================ */
    async function init() {
        /* Wire up buttons */
        $('prev-month').addEventListener('click', onPrevMonth);
        $('next-month').addEventListener('click', onNextMonth);
        $('add-salary-btn').addEventListener('click', onAddSalary);
        $('add-transaction-btn').addEventListener('click', onAddTransaction);
        $('copy-last-month-btn').addEventListener('click', onCopyFromLastMonth);

        /* Salary modal */
        $('salary-form').addEventListener('submit', onSalarySubmit);
        $('modal-close-sal').addEventListener('click', () => closeModal('salary-modal'));
        $('modal-cancel-sal').addEventListener('click', () => closeModal('salary-modal'));

        /* Transaction modal */
        $('transaction-form').addEventListener('submit', onTransactionSubmit);
        $('modal-close-tx').addEventListener('click', () => closeModal('transaction-modal'));
        $('modal-cancel-tx').addEventListener('click', () => closeModal('transaction-modal'));

        /* Delete modal */
        $('delete-cancel').addEventListener('click', () => { closeModal('delete-modal'); deletingType = null; deletingId = null; });
        $('delete-confirm').addEventListener('click', onConfirmDelete);

        /* Filters */
        $('filter-category').addEventListener('change', onFilterChange);
        $('filter-status').addEventListener('change', onFilterChange);

        /* Delegation for dynamic elements */
        setupDelegation();

        /* Resize handler for donut chart — only on width change.
           iOS Safari fires 'resize' on scroll when browser chrome hides/shows
           (viewport height changes). Ignoring height-only changes prevents the
           donut from restarting its animation every time the user scrolls. */
        let resizeTimer;
        let _lastResizeW = window.innerWidth;
        window.addEventListener('resize', () => {
            clearTimeout(resizeTimer);
            resizeTimer = setTimeout(() => {
                if (window.innerWidth === _lastResizeW) return;
                _lastResizeW = window.innerWidth;
                const totals = Storage.calculateTotals(currentMonthData);
                Charts.renderDonut($('chart-donut'), totals.categoryBreakdown, totals.totalSpent);
            }, 250);
        });

        /* Setup currency masks */
        setupCurrencyMask($('salary-value'));
        setupCurrencyMask($('field-value'));

        /* Initial render */
        await renderAll();
    }

    /* Boot — aguarda a sessão do Supabase estar confirmada (ver auth guard
       no <body> do index.html) antes de buscar dados do usuário. */
    async function boot() {
        const session = await Auth.requireSession();
        if (!session) return; // Auth.requireSession já redireciona pro login
        await init();
        document.body.classList.remove('app-loading');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }

    return { renderAll, toast };
})();
