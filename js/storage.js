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

    /* ---------- Configurações locais (não vão pro Supabase) ----------
       A divisão do orçamento (essencial/estilo de vida/investimento)
       é só uma preferência de como o usuário quer fatiar a própria
       renda — não é um dado financeiro em si, então fica salva no
       localStorage do navegador em vez de virar mais uma tabela. */
    const BUDGET_SPLIT_KEY = 'fluxy:budgetSplit';
    const DEFAULT_SPLIT = { essential: 50, lifestyle: 30, investment: 20 };

    function getBudgetSplit() {
        try {
            const raw = localStorage.getItem(BUDGET_SPLIT_KEY);
            if (!raw) return { ...DEFAULT_SPLIT };
            const parsed = JSON.parse(raw);
            const sum = (parsed.essential || 0) + (parsed.lifestyle || 0) + (parsed.investment || 0);
            return sum === 100 ? parsed : { ...DEFAULT_SPLIT };
        } catch {
            return { ...DEFAULT_SPLIT };
        }
    }

    function setBudgetSplit(split) {
        localStorage.setItem(BUDGET_SPLIT_KEY, JSON.stringify(split));
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
            status: row.status,
            recorrente: !!row.recorrente
        };
    }

    function rowToGoal(row) {
        return {
            id: row.id,
            name: row.nome,
            target: parseFloat(row.valor_alvo) || 0,
            current: parseFloat(row.valor_atual) || 0,
            color: row.cor || '#e3a53d'
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

    /* ---------- Salary CRUD ----------
       Cada função retorna { ok, error } em vez de engolir o erro do
       Supabase — quem chamar decide o que mostrar ao usuário. Antes
       o erro só ia pro console.error e a UI seguia como se tivesse
       dado tudo certo (por isso o toast de sucesso aparecia mesmo
       quando nada era salvo). */
    async function addSalary(monthKey, salary) {
        const userId = await getUserId();
        if (!userId) return { ok: false, error: 'Usuário não autenticado.' };
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
        if (error) { console.error('Erro ao adicionar renda:', error); return { ok: false, error: error.message }; }
        return { ok: true };
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
        if (error) { console.error('Erro ao atualizar renda:', error); return { ok: false, error: error.message }; }
        return { ok: true };
    }

    async function deleteSalary(_monthKey, salaryId) {
        const { error } = await supabaseClient.from('entries').delete().eq('id', salaryId);
        if (error) { console.error('Erro ao remover renda:', error); return { ok: false, error: error.message }; }
        return { ok: true };
    }

    /* ---------- Transaction CRUD ---------- */
    async function addTransaction(monthKey, tx) {
        const userId = await getUserId();
        if (!userId) return { ok: false, error: 'Usuário não autenticado.' };
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
            recorrente: !!tx.recorrente,
            mes_referencia: `${year}-${String(month + 1).padStart(2, '0')}-01`
        });
        if (error) { console.error('Erro ao adicionar transação:', error); return { ok: false, error: error.message }; }
        return { ok: true };
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
        if (updates.recorrente !== undefined) patch.recorrente = !!updates.recorrente;

        const { error } = await supabaseClient.from('entries').update(patch).eq('id', txId);
        if (error) { console.error('Erro ao atualizar transação:', error); return { ok: false, error: error.message }; }
        return { ok: true };
    }

    async function deleteTransaction(_monthKey, txId) {
        const { error } = await supabaseClient.from('entries').delete().eq('id', txId);
        if (error) { console.error('Erro ao excluir transação:', error); return { ok: false, error: error.message }; }
        return { ok: true };
    }

    /* ---------- Transações recorrentes ----------
       Ao entrar num mês, procura no mês anterior os lançamentos
       marcados como recorrentes e clona pro mês atual os que ainda
       não existem por lá (checando nome+categoria pra não duplicar
       se o usuário já tiver adicionado manualmente ou clonado antes).
       Se a coluna `recorrente` ainda não existir no banco (migração
       não rodada), a query falha e a função só sai de mansinho —
       o resto do app continua funcionando normalmente. */
    function shiftDateToMonth(dateStr, monthKey) {
        const { year, month } = parseMonthKey(monthKey);
        const day = dateStr ? dateStr.split('-')[2] : '01';
        return `${year}-${String(month + 1).padStart(2, '0')}-${day}`;
    }

    async function ensureRecurringForMonth(monthKey) {
        const userId = await getUserId();
        if (!userId) return;
        await ensureCategories();

        const prevKey = navigateMonth(monthKey, -1);
        const { start, end } = monthRange(prevKey);

        const { data: prevRows, error } = await supabaseClient
            .from('entries').select('*')
            .eq('user_id', userId)
            .eq('natureza', 'despesa')
            .eq('recorrente', true)
            .gte('mes_referencia', start)
            .lt('mes_referencia', end);

        if (error || !prevRows || prevRows.length === 0) return;

        const curData = await getMonthData(monthKey);
        const existing = new Set(curData.transactions.map(t => `${t.description}|${t.category}`));

        for (const row of prevRows) {
            const slug = categorySlugById(row.categoria_id);
            const key = `${row.nome}|${slug}`;
            if (existing.has(key)) continue;

            await addTransaction(monthKey, {
                date: shiftDateToMonth(row.vencimento, monthKey),
                category: slug,
                description: row.nome,
                paymentMethod: row.forma_pagamento || 'pix',
                classification: row.classificacao || 'essencial',
                value: parseFloat(row.valor) || 0,
                status: 'pendente',
                recorrente: true
            });
        }
    }

    /* ---------- Metas de economia ---------- */
    async function getGoals() {
        const userId = await getUserId();
        if (!userId) return [];
        try {
            const { data, error } = await supabaseClient
                .from('goals').select('*')
                .eq('user_id', userId)
                .order('created_at', { ascending: true });
            if (error) { console.error('Erro ao buscar metas:', error); return []; }
            return (data || []).map(rowToGoal);
        } catch (e) {
            console.error('Erro ao buscar metas:', e);
            return [];
        }
    }

    async function addGoal(goal) {
        const userId = await getUserId();
        if (!userId) return { ok: false, error: 'Usuário não autenticado.' };
        const { error } = await supabaseClient.from('goals').insert({
            user_id: userId,
            nome: goal.name,
            valor_alvo: goal.target,
            valor_atual: goal.current || 0,
            cor: goal.color || '#e3a53d'
        });
        if (error) { console.error('Erro ao criar meta:', error); return { ok: false, error: error.message }; }
        return { ok: true };
    }

    async function contributeToGoal(goalId, amount, currentValue) {
        const newValue = Math.max(0, (parseFloat(currentValue) || 0) + amount);
        const { error } = await supabaseClient.from('goals').update({ valor_atual: newValue }).eq('id', goalId);
        if (error) { console.error('Erro ao atualizar meta:', error); return { ok: false, error: error.message }; }
        return { ok: true, newValue };
    }

    async function deleteGoal(goalId) {
        const { error } = await supabaseClient.from('goals').delete().eq('id', goalId);
        if (error) { console.error('Erro ao excluir meta:', error); return { ok: false, error: error.message }; }
        return { ok: true };
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
    function calculateTotals(monthData, split) {
        const s = split || getBudgetSplit();

        const totalIncome = monthData.salaries
            .reduce((s, sal) => s + (parseFloat(sal.value) || 0), 0);

        const paid   = monthData.transactions.filter(t => t.status === 'pago');
        const pend   = monthData.transactions.filter(t => t.status === 'pendente');

        const totalSpent   = paid.reduce((s, t) => s + Math.abs(parseFloat(t.value) || 0), 0);
        const totalPending = pend.reduce((s, t) => s + Math.abs(parseFloat(t.value) || 0), 0);
        const remaining    = totalIncome - totalSpent;

        /* Faixas de orçamento (editáveis pelo usuário — ver getBudgetSplit) */
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
            essentialBudget:  totalIncome * (s.essential  / 100),
            lifestyleBudget:  totalIncome * (s.lifestyle  / 100),
            investmentBudget: totalIncome * (s.investment / 100),
            essentialPct:  s.essential,
            lifestylePct:  s.lifestyle,
            investmentPct: s.investment,
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
        ensureRecurringForMonth,
        getGoals,
        addGoal,
        contributeToGoal,
        deleteGoal,
        clearMonth,
        bulkAdd,
        calculateTotals,
        ensureCategories,
        getBudgetSplit,
        setBudgetSplit,
        MONTHS_PT
    };
})();
