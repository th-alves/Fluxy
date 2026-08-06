/* ============================================
   STORAGE MODULE — Persistência (Supabase) & Cálculos
   ============================================
   Mantém a MESMA "forma" de dados que o app.js sempre usou
   (monthData.salaries / monthData.transactions com os campos
   description, value, date, category, paymentMethod,
   classification, status) — só que agora lendo e gravando na
   tabela `entries` do Supabase, em vez do localStorage.

   Mapeamento:
     entries.natureza = 'receita'  → vira um "salary"
     entries.natureza = 'despesa'  → vira uma "transaction"
     entries.categoria_id          → resolvido via tabela categories
     entries.vencimento            → date (transações) / dia do mês (rendas)
     entries.mes_referencia        → mês/ano do dashboard (sempre dia 01)
   ============================================ */
const Storage = (() => {
    const MONTHS_PT = [
        'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
        'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
    ];

    /* Categorias padrão — mesmos slugs/cores que o app já usava
       via CSS (--cat-contas, --cat-parcela, ...), seguindo o schema
       "categories(nome, cor)" do Supabase. */
    const DEFAULT_CATEGORIES = [
        { nome: 'contas',      cor: '#c4864a' },
        { nome: 'parcela',     cor: '#98a1ae' },
        { nome: 'assinatura',  cor: '#6fa89f' },
        { nome: 'fatura',      cor: '#9b7fb5' },
        { nome: 'futuro',      cor: '#6e93bf' },
        { nome: 'compras',     cor: '#c4708a' }
    ];

    /* ---------- Helpers de data/mês (puros, sem rede) ---------- */
    function getCurrentMonthKey() {
        const now = new Date();
        return formatMonthKey(now.getFullYear(), now.getMonth());
    }

    function formatMonthKey(year, month) {
        return `${year}-${String(month + 1).padStart(2, '0')}`;
    }

    function parseMonthKey(key) {
        const [year, month] = key.split('-').map(Number);
        return { year, month: month - 1 };
    }

    function getMonthName(key) {
        const { year, month } = parseMonthKey(key);
        return `${MONTHS_PT[month]} ${year}`;
    }

    function navigateMonth(currentKey, direction) {
        const { year, month } = parseMonthKey(currentKey);
        let newMonth = month + direction;
        let newYear = year;
        if (newMonth > 11) { newMonth = 0; newYear++; }
        if (newMonth < 0) { newMonth = 11; newYear--; }
        return formatMonthKey(newYear, newMonth);
    }

    function monthRange(monthKey) {
        const { year, month } = parseMonthKey(monthKey);
        const start = `${year}-${String(month + 1).padStart(2, '0')}-01`;
        const endD = new Date(year, month + 1, 1);
        const end = `${endD.getFullYear()}-${String(endD.getMonth() + 1).padStart(2, '0')}-01`;
        return { start, end };
    }

    /* ---------- Sessão / usuário ---------- */
    async function getUserId() {
        const { data, error } = await supabaseClient.auth.getUser();
        if (error || !data?.user) {
            console.error('Usuário não autenticado:', error);
            return null;
        }
        return data.user.id;
    }

    /* ---------- Categorias (cache em memória) ---------- */
    let _categoriesCache = null;

    async function ensureCategories() {
        if (_categoriesCache) return _categoriesCache;

        const userId = await getUserId();
        if (!userId) return [];

        let { data, error } = await supabaseClient
            .from('categories').select('*').eq('user_id', userId);

        if (error) {
            console.error('Erro ao buscar categorias:', error);
            return [];
        }

        if (!data || data.length === 0) {
            const toInsert = DEFAULT_CATEGORIES.map(c => ({ ...c, user_id: userId }));
            const { data: inserted, error: insErr } = await supabaseClient
                .from('categories').insert(toInsert).select();
            if (insErr) {
                console.error('Erro ao criar categorias padrão:', insErr);
                return [];
            }
            data = inserted;
        }

        _categoriesCache = data;
        return data;
    }

    function categoryIdBySlug(slug) {
        const cat = (_categoriesCache || []).find(c => c.nome === slug);
        return cat ? cat.id : null;
    }

    function categorySlugById(id) {
        const cat = (_categoriesCache || []).find(c => c.id === id);
        return cat ? cat.nome : 'contas';
    }

    /* ---------- Row (Supabase) <-> Shape (app.js) ---------- */
    function rowToSalary(row) {
        const day = row.vencimento ? parseInt(row.vencimento.split('-')[2], 10) : 1;
        return { id: row.id, description: row.nome, value: parseFloat(row.valor) || 0, day };
    }

    function rowToTransaction(row) {
        return {
            id: row.id,
            date: row.vencimento,
            category: categorySlugById(row.categoria_id),
            description: row.nome,
            paymentMethod: row.forma_pagamento || 'pix',
            classification: row.classificacao || 'essencial',
            value: parseFloat(row.valor) || 0,
            status: row.status
        };
    }

    /* ---------- Leitura ---------- */
    async function getMonthData(monthKey) {
        await ensureCategories();
        const userId = await getUserId();
        if (!userId) return { salaries: [], transactions: [] };

        const { start, end } = monthRange(monthKey);
        const { data, error } = await supabaseClient
            .from('entries').select('*')
            .eq('user_id', userId)
            .gte('mes_referencia', start)
            .lt('mes_referencia', end);

        if (error) {
            console.error('Erro ao buscar lançamentos:', error);
            return { salaries: [], transactions: [] };
        }

        return {
            salaries: data.filter(r => r.natureza === 'receita').map(rowToSalary),
            transactions: data.filter(r => r.natureza !== 'receita').map(rowToTransaction)
        };
    }

    /* Todos os lançamentos do usuário, agrupados por mês — usado nas sparklines */
    async function getAllData() {
        await ensureCategories();
        const userId = await getUserId();
        if (!userId) return { months: {} };

        const { data, error } = await supabaseClient
            .from('entries').select('*').eq('user_id', userId);

        if (error) {
            console.error('Erro ao buscar histórico:', error);
            return { months: {} };
        }

        const months = {};
        data.forEach(row => {
            const key = (row.mes_referencia || '').slice(0, 7);
            if (!key) return;
            if (!months[key]) months[key] = { salaries: [], transactions: [] };
            if (row.natureza === 'receita') months[key].salaries.push(rowToSalary(row));
            else months[key].transactions.push(rowToTransaction(row));
        });
        return { months };
    }

    /* ---------- Salary CRUD ---------- */
    async function addSalary(monthKey, salary) {
        const userId = await getUserId();
        if (!userId) return;
        const { year, month } = parseMonthKey(monthKey);
        const day = Math.min(Math.max(parseInt(salary.day, 10) || 1, 1), 28);
        const vencimento = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

        const { error } = await supabaseClient.from('entries').insert({
            user_id: userId,
            nome: salary.description,
            valor: salary.value,
            tipo: 'fixo',
            natureza: 'receita',
            vencimento,
            status: 'pago',
            mes_referencia: `${year}-${String(month + 1).padStart(2, '0')}-01`
        });
        if (error) console.error('Erro ao adicionar renda:', error);
    }

    async function updateSalary(monthKey, salaryId, updates) {
        const patch = {};
        if (updates.description !== undefined) patch.nome = updates.description;
        if (updates.value !== undefined) patch.valor = updates.value;
        if (updates.day !== undefined) {
            const { year, month } = parseMonthKey(monthKey);
            patch.vencimento = `${year}-${String(month + 1).padStart(2, '0')}-${String(updates.day).padStart(2, '0')}`;
        }
        const { error } = await supabaseClient.from('entries').update(patch).eq('id', salaryId);
        if (error) console.error('Erro ao atualizar renda:', error);
    }

    async function deleteSalary(_monthKey, salaryId) {
        const { error } = await supabaseClient.from('entries').delete().eq('id', salaryId);
        if (error) console.error('Erro ao remover renda:', error);
    }

    /* ---------- Transaction CRUD ---------- */
    async function addTransaction(monthKey, tx) {
        const userId = await getUserId();
        if (!userId) return;
        await ensureCategories();
        const { year, month } = parseMonthKey(monthKey);

        const { error } = await supabaseClient.from('entries').insert({
            user_id: userId,
            categoria_id: categoryIdBySlug(tx.category),
            nome: tx.description,
            valor: tx.value,
            tipo: 'avulso',
            natureza: 'despesa',
            forma_pagamento: tx.paymentMethod,
            classificacao: tx.classification,
            vencimento: tx.date,
            status: tx.status,
            mes_referencia: `${year}-${String(month + 1).padStart(2, '0')}-01`
        });
        if (error) console.error('Erro ao adicionar transação:', error);
    }

    async function updateTransaction(_monthKey, txId, updates) {
        await ensureCategories();
        const patch = {};
        if (updates.description !== undefined) patch.nome = updates.description;
        if (updates.value !== undefined) patch.valor = updates.value;
        if (updates.category !== undefined) patch.categoria_id = categoryIdBySlug(updates.category);
        if (updates.paymentMethod !== undefined) patch.forma_pagamento = updates.paymentMethod;
        if (updates.classification !== undefined) patch.classificacao = updates.classification;
        if (updates.date !== undefined) patch.vencimento = updates.date;
        if (updates.status !== undefined) patch.status = updates.status;

        const { error } = await supabaseClient.from('entries').update(patch).eq('id', txId);
        if (error) console.error('Erro ao atualizar transação:', error);
    }

    async function deleteTransaction(_monthKey, txId) {
        const { error } = await supabaseClient.from('entries').delete().eq('id', txId);
        if (error) console.error('Erro ao excluir transação:', error);
    }

    /* ---------- Bulk (usado na importação de planilha) ---------- */
    async function clearMonth(monthKey) {
        const userId = await getUserId();
        if (!userId) return;
        const { start, end } = monthRange(monthKey);
        const { error } = await supabaseClient
            .from('entries').delete()
            .eq('user_id', userId)
            .gte('mes_referencia', start)
            .lt('mes_referencia', end);
        if (error) console.error('Erro ao limpar mês:', error);
    }

    async function bulkAdd(monthKey, salaries, transactions) {
        for (const s of salaries) await addSalary(monthKey, s);
        for (const t of transactions) await addTransaction(monthKey, t);
    }

    /* ---------- Financial Calculations (puro, sem rede) ---------- */
    function calculateTotals(monthData) {
        const totalIncome = monthData.salaries
            .reduce((s, sal) => s + (parseFloat(sal.value) || 0), 0);

        const paid   = monthData.transactions.filter(t => t.status === 'pago');
        const pend   = monthData.transactions.filter(t => t.status === 'pendente');

        const totalSpent   = paid.reduce((s, t) => s + Math.abs(parseFloat(t.value) || 0), 0);
        const totalPending = pend.reduce((s, t) => s + Math.abs(parseFloat(t.value) || 0), 0);
        const remaining    = totalIncome - totalSpent;

        /* 50 / 30 / 20 */
        const essentialSpent = paid
            .filter(t => t.classification === 'essencial')
            .reduce((s, t) => s + Math.abs(parseFloat(t.value) || 0), 0);
        const lifestyleSpent = paid
            .filter(t => t.classification === 'estilo-de-vida')
            .reduce((s, t) => s + Math.abs(parseFloat(t.value) || 0), 0);
        const investmentSpent = paid
            .filter(t => t.classification === 'investimento')
            .reduce((s, t) => s + Math.abs(parseFloat(t.value) || 0), 0);

        /* Per-category breakdown (expenses only) */
        const categoryBreakdown = {};
        paid.forEach(t => {
            if (!categoryBreakdown[t.category]) categoryBreakdown[t.category] = 0;
            categoryBreakdown[t.category] += Math.abs(parseFloat(t.value) || 0);
        });

        return {
            totalIncome,
            totalSpent,
            totalPending,
            remaining,
            essentialSpent,
            lifestyleSpent,
            investmentSpent,
            essentialBudget:  totalIncome * 0.5,
            lifestyleBudget:  totalIncome * 0.3,
            investmentBudget: totalIncome * 0.2,
            categoryBreakdown
        };
    }

    /* ---------- Public API ---------- */
    return {
        getCurrentMonthKey,
        formatMonthKey,
        parseMonthKey,
        getMonthName,
        navigateMonth,
        getAllData,
        getMonthData,
        addSalary,
        updateSalary,
        deleteSalary,
        addTransaction,
        updateTransaction,
        deleteTransaction,
        clearMonth,
        bulkAdd,
        calculateTotals,
        ensureCategories,
        MONTHS_PT
    };
})();
