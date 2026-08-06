/* ============================================
   AUTH MODULE — Sessão & Google OAuth (Supabase)
   ============================================ */
const Auth = (() => {

    async function getSession() {
        if (!supabaseClient) return null;
        const { data, error } = await supabaseClient.auth.getSession();
        if (error) {
            console.error('Erro ao obter sessão:', error);
            return null;
        }
        return data.session;
    }

    async function signInWithGoogle() {
        if (!supabaseClient) return;
        const { error } = await supabaseClient.auth.signInWithOAuth({
            provider: 'google',
            options: {
                redirectTo: window.location.origin + window.location.pathname.replace('login.html', 'index.html')
            }
        });
        if (error) {
            console.error('Erro no login com Google:', error);
            showLoginError('Não foi possível iniciar o login com Google. Tente novamente.');
        }
    }

    async function signOut() {
        if (!supabaseClient) return;
        await supabaseClient.auth.signOut();
        window.location.href = 'login.html';
    }

    /* ---------- Guard: usado em index.html ---------- */
    async function requireSession() {
        const session = await getSession();
        if (!session) {
            window.location.href = 'login.html';
            return null;
        }
        renderUserMenu(session.user);
        return session;
    }

    /* ---------- Guard inverso: usado em login.html ---------- */
    async function redirectIfLoggedIn() {
        const session = await getSession();
        if (session) {
            window.location.href = 'index.html';
        }
    }

    function renderUserMenu(user) {
        const mount = document.getElementById('user-menu');
        if (!mount || !user) return;

        const name = user.user_metadata?.full_name || user.user_metadata?.name || user.email || 'Conta';
        const avatar = user.user_metadata?.avatar_url || user.user_metadata?.picture || '';
        const initial = name.charAt(0).toUpperCase();

        mount.innerHTML = `
            <div class="user-menu">
                <div class="user-menu-avatar">
                    ${avatar ? `<img src="${avatar}" alt="${name}" referrerpolicy="no-referrer">` : `<span>${initial}</span>`}
                </div>
                <span class="user-menu-name">${name}</span>
                <button class="btn-icon user-menu-logout" id="logout-btn" title="Sair">
                    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M15 17L20 12M20 12L15 7M20 12H9" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
                        <path d="M9 21H6C4.9 21 4 20.1 4 19V5C4 3.9 4.9 3 6 3H9" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
                    </svg>
                </button>
            </div>`;

        document.getElementById('logout-btn').addEventListener('click', openLogoutModal);
        setupLogoutModal();
    }

    /* ---------- Modal de confirmação de logout ---------- */
    function openLogoutModal() {
        const modal = document.getElementById('logout-modal');
        if (!modal) { signOut(); return; } // fallback caso o modal não exista na página
        modal.classList.add('active');
        document.body.style.overflow = 'hidden';
    }

    function closeLogoutModal() {
        const modal = document.getElementById('logout-modal');
        if (modal) modal.classList.remove('active');
        document.body.style.overflow = '';
    }

    function setupLogoutModal() {
        const modal = document.getElementById('logout-modal');
        if (!modal || modal.dataset.wired) return;
        modal.dataset.wired = 'true';

        document.getElementById('logout-cancel')?.addEventListener('click', closeLogoutModal);
        document.getElementById('logout-confirm')?.addEventListener('click', () => {
            closeLogoutModal();
            signOut();
        });
        modal.addEventListener('click', (e) => {
            if (e.target === modal) closeLogoutModal();
        });
    }

    function showLoginError(message) {
        const el = document.getElementById('login-error');
        if (!el) return;
        el.textContent = message;
        el.classList.add('active');
    }

    return { getSession, signInWithGoogle, signOut, requireSession, redirectIfLoggedIn };
})();
