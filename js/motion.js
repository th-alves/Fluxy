/* ============================================
   MOTION MODULE — Purely presentational polish.
   Never reads or writes app state; only watches
   the DOM the other modules already render.
   ============================================ */
(() => {
    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    /* ---------- Spotlight that follows the cursor on cards ---------- */
    function bindSpotlight(el) {
        el.addEventListener('pointermove', (e) => {
            const rect = el.getBoundingClientRect();
            el.style.setProperty('--mx', `${e.clientX - rect.left}px`);
            el.style.setProperty('--my', `${e.clientY - rect.top}px`);
        });
    }

    function initSpotlights() {
        document.querySelectorAll('.summary-card').forEach(bindSpotlight);
    }

    /* ---------- Gentle count-up whenever a summary value changes ---------- */
    function parseCurrency(str) {
        if (!str) return 0;
        const cleaned = str.replace(/[^\d,-]/g, '').replace(/\./g, '').replace(',', '.');
        const n = parseFloat(cleaned);
        return isNaN(n) ? 0 : n;
    }

    function formatCurrency(n) {
        return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    }

    /* Note: App's internal functions call its own closured `renderAll`
       directly, not through the exported App.renderAll reference, so
       monkey-patching the export never fires. A MutationObserver is the
       reliable way to notice when app.js rewrites these nodes — we just
       disconnect it while WE are the ones writing, so it never reacts to
       its own animation frames. */
    function animateValue(el, from, to, observer) {
        if (prefersReduced || Math.abs(to - from) < 0.005) {
            el.textContent = formatCurrency(to);
            return;
        }
        const dur = 500;
        const t0 = performance.now();
        const ease = t => 1 - Math.pow(1 - t, 3);

        if (observer) observer.disconnect();

        function frame(now) {
            const p = Math.min((now - t0) / dur, 1);
            const val = from + (to - from) * ease(p);
            el.textContent = formatCurrency(val);
            if (p < 1) {
                requestAnimationFrame(frame);
            } else {
                el.textContent = formatCurrency(to);
                if (observer) observer.observe(el, { childList: true, characterData: true, subtree: true });
            }
        }
        requestAnimationFrame(frame);
    }

    function watchSummaryCards() {
        const ids = ['card-income', 'card-spent', 'card-remaining', 'card-pending'];

        ids.forEach(id => {
            const el = document.getElementById(id);
            if (!el) return;

            let lastValue = parseCurrency(el.textContent);

            const observer = new MutationObserver(() => {
                const newVal = parseCurrency(el.textContent);
                if (Math.abs(newVal - lastValue) > 0.001) {
                    const prevVal = lastValue;
                    lastValue = newVal;
                    animateValue(el, prevVal, newVal, observer);
                }
            });
            observer.observe(el, { childList: true, characterData: true, subtree: true });
        });
    }

    function init() {
        initSpotlights();
        watchSummaryCards();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
