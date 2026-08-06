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

    /* NOTE: this module used to also run its own count-up animation on
       the summary cards (card-income, card-spent, card-remaining,
       card-pending), driven by a MutationObserver watching those same
       elements. app.js already animates those numbers itself. Having
       both meant every frame app.js wrote was seen as "a change" by
       this module's observer, which reacted by kicking off ANOTHER
       count animation on top of the one already running — the two
       fought over the same element and settled on a wrong, cut-off
       number. That's what caused the totals to look wrong right after
       switching months. Removed here; app.js is the single source of
       truth for those numbers now. */

    /* ---------- Ambient scramble on the brand title ----------
       De vez em quando (a cada ~9–17s, sorteado) o "Fluxy" do cabeçalho
       balança as letras num efeito bem sutil, lento e fluido antes de
       assentar de volta na palavra certa — puro toque de marca, não
       mexe em nada do app. Cada letra vira um <span> próprio pra poder animar uma de
       cada vez, em onda (defasagem crescente da esquerda pra direita),
       o que é o que dá a sensação de fluidez em vez de um flicker seco.
       Some sozinho se prefers-reduced-motion estiver ativo. */
    function initBrandScramble() {
        if (prefersReduced) return;
        const el = document.querySelector('.brand-text h1');
        if (!el) return;

        const original = el.textContent;
        el.setAttribute('aria-label', original);
        el.innerHTML = original
            .split('')
            .map(ch => (ch === ' ' ? ' ' : `<span class="brand-letter" aria-hidden="true">${ch}</span>`))
            .join('');

        const letters = [...el.querySelectorAll('.brand-letter')];
        const pool = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
        const randomChar = () => pool[Math.floor(Math.random() * pool.length)];

        let running = false;

        function cycle() {
            if (running || document.hidden) return;
            running = true;

            const stepDelay = 150;   // troca de letra a cada 150ms — bem devagar
            const stepsPerChar = 4;  // 4 letras aleatórias até assentar na certa
            const stagger = 120;     // defasagem entre uma letra e a próxima → onda mais larga
            let pending = letters.length;

            letters.forEach((span, i) => {
                const finalChar = span.textContent;

                for (let s = 0; s < stepsPerChar; s++) {
                    setTimeout(() => {
                        span.classList.add('is-flipping');
                        span.textContent = randomChar();
                    }, i * stagger + s * stepDelay);
                }

                setTimeout(() => {
                    span.textContent = finalChar;
                    span.classList.remove('is-flipping');
                    pending--;
                    if (pending === 0) running = false;
                }, i * stagger + stepsPerChar * stepDelay);
            });
        }

        function scheduleNext() {
            const delay = 9000 + Math.random() * 8000; // entre 9s e 17s
            setTimeout(() => {
                cycle();
                scheduleNext();
            }, delay);
        }

        scheduleNext();
    }

    function init() {
        initSpotlights();
        initBrandScramble();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
