/* ============================================
   SUPABASE CLIENT — Configuração de conexão
   ============================================
   Preencha SUPABASE_ANON_KEY abaixo com a "anon / public" key
   do seu projeto (Project Settings → API → Project API keys).
   Essa chave é segura para expor no front-end (é protegida pelas
   políticas de Row Level Security do banco). NUNCA coloque aqui
   a "service_role key" nem o Client Secret do Google.
   ============================================ */

const SUPABASE_URL = 'https://qfhvtpwkydskytnkooim.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_bp7l3swOHzoYb2sAWfbd2Q_U6W8uSR2';

const supabaseClient = (() => {
    if (typeof window.supabase === 'undefined') {
        console.error('SDK do Supabase não carregado. Verifique o <script> do supabase-js no HTML.');
        return null;
    }
    if (!SUPABASE_ANON_KEY || SUPABASE_ANON_KEY === 'sb_publishable_bp7l3swOHzoYb2sAWfbd2Q_U6W8uSR2') {
        console.warn('⚠️ Configure SUPABASE_ANON_KEY em js/supabase-client.js para habilitar o login.');
    }
    return window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: {
            persistSession: true,
            autoRefreshToken: true,
            detectSessionInUrl: true
        }
    });
})();
