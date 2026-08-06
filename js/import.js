/* ============================================
   IMPORT MODULE — Leitura de Planilhas XLSX/CSV
   ============================================ */
const ImportModule = (() => {

    /* ---------- Mapas reversos (label → valor interno) ---------- */
    const CAT_MAP = {
        'contas':     'contas',
        'parcela':    'parcela',
        'assinatura': 'assinatura',
        'fatura':     'fatura',
        'futuro':     'futuro',
        'compras':    'compras'
    };

    const PAY_MAP = {
        'pix':               'pix',
        'conta corrente':    'conta-corrente',
        'cartao de credito': 'cartao-credito',
        'cartao credito':    'cartao-credito',
        'cartao de debito':  'cartao-debito',
        'cartao debito':     'cartao-debito',
        'dinheiro':          'dinheiro',
        'boleto':            'boleto'
    };

    const CLASS_MAP = {
        'essencial (50%)':      'essencial',
        'essencial':            'essencial',
        'estilo de vida (30%)': 'estilo-de-vida',
        'estilo de vida':       'estilo-de-vida',
        'investimento (20%)':   'investimento',
        'investimento':         'investimento'
    };

    /* Índice 0-based de cada mês em PT */
    const MONTHS_PT = [
        'janeiro','fevereiro','marco','abril','maio','junho',
        'julho','agosto','setembro','outubro','novembro','dezembro'
    ];

    /* Dados pendentes de confirmação (array de grupos por mês) */
    let _pending = null;

    /* ---------- Utilitários ---------- */

    /** Normaliza: minúsculo + sem acento + sem espaço extra */
    function norm(str) {
        return String(str ?? '').trim().toLowerCase()
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    }

    function mapCategory(val)       { return CAT_MAP[norm(val)]   || 'contas';    }
    function mapPayment(val)        { return PAY_MAP[norm(val)]    || 'pix';       }
    function mapClassification(val) { return CLASS_MAP[norm(val)]  || 'essencial'; }
    function mapStatus(val)         { return norm(val) === 'pago'  ? 'pago' : 'pendente'; }

    /**
     * Converte qualquer representação de data para YYYY-MM-DD.
     * Aceita: ISO (YYYY-MM-DD), BR (DD/MM/YYYY) e serial numérico do Excel.
     */
    function parseDate(val) {
        if (val == null || val === '') return '';

        /* Objeto Date nativo (SheetJS às vezes retorna isso) */
        if (val instanceof Date) {
            const y = val.getFullYear();
            const m = String(val.getMonth() + 1).padStart(2, '0');
            const d = String(val.getDate()).padStart(2, '0');
            return `${y}-${m}-${d}`;
        }

        const s = String(val).trim();
        if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;                     // ISO
        if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) {                           // BR
            const [d, m, y] = s.split('/');
            return `${y}-${m}-${d}`;
        }

        /* Serial numérico do Excel (dias desde 1899-12-30) */
        const num = parseFloat(s);
        if (!isNaN(num) && num > 1000) {
            const date = new Date(Date.UTC(1899, 11, 30) + num * 86400000);
            return date.toISOString().split('T')[0];
        }
        return '';
    }

    /**
     * Infere monthKey a partir do nome da aba + ano encontrado nas linhas.
     * Ex: aba "Março", ano 2026 → "2026-03"
     */
    function monthFromSheetName(sheetName, year) {
        const idx = MONTHS_PT.indexOf(norm(sheetName));
        if (idx !== -1 && year > 2000 && year < 2100) {
            return Storage.formatMonthKey(year, idx);
        }
        return null;
    }

    /**
     * Tenta extrair o ano da primeira data válida encontrada nas linhas.
     */
    function yearFromRows(rows, dateColIdx) {
        for (const row of rows) {
            const d = parseDate(row?.[dateColIdx]);
            if (d && /^\d{4}/.test(d)) return parseInt(d.split('-')[0]);
        }
        return new Date().getFullYear();   // fallback: ano atual
    }

    /**
     * Infere monthKey a partir do título do Flux exportado.
     * Ex: "Controle Financeiro — Maio 2026" → "2026-05"
     */
    function monthFromTitle(titleStr) {
        const after = String(titleStr).split('—')[1];
        if (!after) return null;
        const parts = after.trim().split(' ');
        const monthIdx = MONTHS_PT.indexOf(norm(parts[0]));
        const year = parseInt(parts[1]);
        if (monthIdx !== -1 && year > 2000 && year < 2100) {
            return Storage.formatMonthKey(year, monthIdx);
        }
        return null;
    }

    /* ---------- Parser: formato exportado pelo Flux ---------- */

    function parseFlux(rows) {
        let detectedMonthKey = null;
        let salaries    = [];
        let transactions = [];

        if (rows[0]?.[0] && String(rows[0][0]).includes('Controle Financeiro')) {
            detectedMonthKey = monthFromTitle(String(rows[0][0]));
        }

        let salarySection      = -1;
        let transactionSection = -1;

        rows.forEach((row, i) => {
            const cell = String(row?.[0] ?? '').trim();
            if (cell === 'SALÁRIOS / RENDAS') salarySection      = i;
            if (cell === 'TRANSAÇÕES')        transactionSection = i;
        });

        /* Salários: pula linha de seção + cabeçalho */
        if (salarySection !== -1) {
            for (let i = salarySection + 2; i < rows.length; i++) {
                const row  = rows[i];
                const col0 = String(row?.[0] ?? '').trim();
                const col1 = String(row?.[1] ?? '').trim();
                if (!col0 || col1 === 'TOTAL RENDA') break;
                if (['RESUMO', 'ORÇAMENTO 50/30/20', 'TRANSAÇÕES'].includes(col0)) break;
                const value = parseFloat(row[2]) || 0;
                if (value > 0) salaries.push({ description: col0, day: parseInt(col1) || null, value });
            }
        }

        /* Transações: pula linha de seção + cabeçalho */
        if (transactionSection !== -1) {
            for (let i = transactionSection + 2; i < rows.length; i++) {
                const row = rows[i];
                if (!row?.[0]) continue;
                const description = String(row[2] ?? '').trim();
                if (!description) continue;
                const value = Math.abs(parseFloat(row[5]) || 0);
                transactions.push({
                    date:           parseDate(row[0]),
                    category:       mapCategory(row[1]),
                    description,
                    paymentMethod:  mapPayment(row[3]),
                    classification: mapClassification(row[4]),
                    value,
                    status:         mapStatus(row[6])
                });
            }
        }

        return [{ salaries, transactions, detectedMonthKey, sheetName: 'Importado' }];
    }

    /* ---------- Parser: aba com cabeçalho genérico ---------- */

    /**
     * Processa UMA aba no formato genérico.
     * Retorna { salaries, transactions, detectedMonthKey, sheetName } ou null.
     */
    function parseSheet(ws, sheetName) {
        /* sheet_to_json com header:1 entrega arrays de células */
        const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false });

        /* Localiza a linha de cabeçalho nas primeiras 15 linhas */
        let headerRow = -1;
        for (let i = 0; i < Math.min(rows.length, 15); i++) {
            const normed = (rows[i] ?? []).map(c => norm(String(c ?? '')));
            /* Precisa ter pelo menos "data" E "descricao" ou "categoria" */
            if (normed.some(h => h === 'data') && normed.some(h => h.includes('descricao') || h === 'categoria')) {
                headerRow = i;
                break;
            }
        }
        if (headerRow === -1) return null;

        const headers = (rows[headerRow] ?? []).map(c => norm(String(c ?? '')));
        const col = {
            date:           headers.findIndex(h => h === 'data'),
            category:       headers.findIndex(h => h === 'categoria'),
            description:    headers.findIndex(h => h.includes('descricao')),
            payment:        headers.findIndex(h => h.includes('pagamento') || h.includes('metodo')),
            classification: headers.findIndex(h => h.includes('classific')),
            value:          headers.findIndex(h => h === 'valor'),
            status:         headers.findIndex(h => h === 'status')
        };

        if (col.date === -1 || col.description === -1) return null;

        /* Detecta o ano pelas datas das linhas de dados */
        const dataRows = rows.slice(headerRow + 1);
        const detectedYear = yearFromRows(dataRows, col.date);

        /* Detecta mês pelo nome da aba */
        const detectedMonthKey = monthFromSheetName(sheetName, detectedYear)
            || (() => {
                /* Fallback: primeira data encontrada */
                for (const row of dataRows) {
                    const d = parseDate(row?.[col.date]);
                    if (d && /^\d{4}-\d{2}-\d{2}$/.test(d)) {
                        const [y, m] = d.split('-').map(Number);
                        return Storage.formatMonthKey(y, m - 1);
                    }
                }
                return null;
            })();

        const salaries    = [];
        const transactions = [];

        for (const row of dataRows) {
            /* Pula linhas completamente vazias */
            const descRaw = String(row?.[col.description] ?? '').trim();
            if (!descRaw) continue;

            const dateVal     = col.date !== -1 ? row[col.date] : '';
            const categoryRaw = col.category !== -1 ? String(row[col.category] ?? '').trim() : '';

            /* Valor: aceita 0 — o usuário pode ter linhas com valor ainda não preenchido */
            let value = 0;
            if (col.value !== -1) {
                const raw = String(row[col.value] ?? '').replace(',', '.').replace(/[^\d.\-]/g, '');
                value = Math.abs(parseFloat(raw) || 0);
            }

            /* Linhas de "Receita" → Salário / Renda */
            if (norm(categoryRaw) === 'receita') {
                const date = parseDate(dateVal);
                salaries.push({
                    description: descRaw,
                    day:         date ? parseInt(date.split('-')[2]) || null : null,
                    value
                });
                continue;
            }

            transactions.push({
                date:           parseDate(dateVal),
                category:       mapCategory(categoryRaw),
                description:    descRaw,
                paymentMethod:  col.payment        !== -1 ? mapPayment(row[col.payment])               : 'pix',
                classification: col.classification !== -1 ? mapClassification(row[col.classification]) : 'essencial',
                value,
                status:         col.status         !== -1 ? mapStatus(row[col.status])                 : 'pendente'
            });
        }

        return { salaries, transactions, detectedMonthKey, sheetName };
    }

    /* ---------- Detecta formato geral e delega ---------- */

    function parseWorkbook(wb) {
        const firstSheet = wb.Sheets[wb.SheetNames[0]];
        const firstRows  = XLSX.utils.sheet_to_json(firstSheet, { header: 1, defval: '' });

        /* Formato Flux: título na primeira célula ou seção "TRANSAÇÕES" presente */
        const firstCell  = String(firstRows[0]?.[0] ?? '');
        const hasSection = firstRows.some(r => String(r?.[0] ?? '').trim() === 'TRANSAÇÕES');

        if (firstCell.includes('Controle Financeiro') || hasSection) {
            return parseFlux(firstRows);
        }

        /* Formato genérico: processa TODAS as abas */
        const groups = [];
        for (const name of wb.SheetNames) {
            const result = parseSheet(wb.Sheets[name], name);
            if (result && (result.salaries.length > 0 || result.transactions.length > 0)) {
                groups.push(result);
            }
        }
        return groups.length > 0 ? groups : null;
    }

    /* ---------- Leitura do arquivo ---------- */

    function readFileAsWorkbook(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload  = e => {
                try {
                    const data = new Uint8Array(e.target.result);
                    /* cellDates:true faz SheetJS converter seriais para Date nativo */
                    resolve(XLSX.read(data, { type: 'array', cellDates: true }));
                } catch (err) { reject(err); }
            };
            reader.onerror = () => reject(new Error('Falha ao ler arquivo'));
            reader.readAsArrayBuffer(file);
        });
    }

    /* ---------- API pública ---------- */

    /**
     * Lê o arquivo, faz o parse e armazena em _pending para confirmação.
     * Retorna array de grupos { salaries, transactions, detectedMonthKey, sheetName }
     * ou null em caso de erro / nenhum dado encontrado.
     */
    async function handleFile(file, currentMonthKey) {
        if (typeof XLSX === 'undefined') {
            alert('Biblioteca SheetJS não carregou. Recarregue a página.');
            return null;
        }

        const wb     = await readFileAsWorkbook(file);
        const groups = parseWorkbook(wb);
        if (!groups || groups.length === 0) return null;

        /* Garante monthKey válido em todos os grupos */
        groups.forEach(g => {
            if (!g.detectedMonthKey) g.detectedMonthKey = currentMonthKey;
        });

        _pending = groups;
        return groups;
    }

    /**
     * Confirma a importação de todos os grupos pendentes.
     * mode: 'add' (acrescenta) | 'replace' (apaga e substitui)
     */
    async function confirmImport(mode) {
        if (!_pending || _pending.length === 0) return false;

        for (const group of _pending) {
            const monthKey = group.detectedMonthKey;

            if (mode === 'replace') {
                await Storage.clearMonth(monthKey);
            }

            await Storage.bulkAdd(monthKey, group.salaries, group.transactions);
        }

        _pending = null;
        return true;
    }

    function clearPending() { _pending = null; }

    /** Sobrescreve o monthKey do único grupo pendente (fallback modo mês manual). */
    function overrideSingleMonthKey(monthKey) {
        if (_pending && _pending.length === 1) {
            _pending[0].detectedMonthKey = monthKey;
        }
    }

    /** Retorna o monthKey do primeiro grupo pendente (para navegar até ele após importar). */
    function getFirstMonthKey() {
        return _pending?.[0]?.detectedMonthKey ?? null;
    }

    return { handleFile, confirmImport, clearPending, overrideSingleMonthKey, getFirstMonthKey };
})();
