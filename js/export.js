/* ============================================
   EXPORT MODULE — Download XLSX via SheetJS
   ============================================ */
const ExportModule = (() => {

    const CATEGORY_LABELS = {
        'receita':    'Receita',
        'contas':     'Contas',
        'parcela':    'Parcela',
        'assinatura': 'Assinatura',
        'fatura':     'Fatura',
        'futuro':     'Futuro',
        'compras':    'Compras'
    };

    const PAYMENT_LABELS = {
        'pix':            'Pix',
        'conta-corrente': 'Conta Corrente',
        'cartao-credito': 'Cartão de Crédito',
        'cartao-debito':  'Cartão de Débito',
        'dinheiro':       'Dinheiro',
        'boleto':         'Boleto'
    };

    const CLASS_LABELS = {
        'renda':          'Renda',
        'essencial':      'Essencial (50%)',
        'estilo-de-vida': 'Estilo de Vida (30%)',
        'investimento':   'Investimento (20%)'
    };

    function fmt(v) {
        return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    }

    function downloadSpreadsheet(monthData, monthKey) {
        if (typeof XLSX === 'undefined') {
            alert('Biblioteca de exportação não carregou. Verifique sua conexão com a internet e recarregue a página.');
            return;
        }

        const totals = Storage.calculateTotals(monthData);
        const monthName = Storage.getMonthName(monthKey);

        /* ---- Build header rows ---- */
        const rows = [];

        /* Title */
        rows.push(['Controle Financeiro — ' + monthName]);
        rows.push([]);

        /* Salaries summary */
        rows.push(['SALÁRIOS / RENDAS']);
        rows.push(['Descrição', 'Dia Recebimento', 'Valor']);
        monthData.salaries.forEach(s => {
            rows.push([s.description || 'Salário', s.day || '', parseFloat(s.value) || 0]);
        });
        rows.push(['', 'TOTAL RENDA', totals.totalIncome]);
        rows.push([]);

        /* Summary */
        rows.push(['RESUMO']);
        rows.push(['Total de Gastos (Pagos)', totals.totalSpent]);
        rows.push(['Total Pendente', totals.totalPending]);
        rows.push(['Sobra Atual', totals.remaining]);
        rows.push([]);

        /* 50/30/20 */
        rows.push(['ORÇAMENTO 50/30/20', 'Gasto', 'Orçamento', '% Utilizado']);
        rows.push([
            'Essencial (50%)',
            totals.essentialSpent,
            totals.essentialBudget,
            totals.essentialBudget > 0 ? ((totals.essentialSpent / totals.essentialBudget) * 100).toFixed(1) + '%' : '0%'
        ]);
        rows.push([
            'Estilo de Vida (30%)',
            totals.lifestyleSpent,
            totals.lifestyleBudget,
            totals.lifestyleBudget > 0 ? ((totals.lifestyleSpent / totals.lifestyleBudget) * 100).toFixed(1) + '%' : '0%'
        ]);
        rows.push([
            'Investimento (20%)',
            totals.investmentSpent,
            totals.investmentBudget,
            totals.investmentBudget > 0 ? ((totals.investmentSpent / totals.investmentBudget) * 100).toFixed(1) + '%' : '0%'
        ]);
        rows.push([]);

        /* Transactions table */
        rows.push(['TRANSAÇÕES']);
        rows.push(['Data', 'Categoria', 'Descrição', 'Método de Pagamento', 'Classificação (50/30/20)', 'Valor', 'Status']);

        const sorted = [...monthData.transactions].sort((a, b) => {
            if (a.date && b.date) return a.date.localeCompare(b.date);
            return 0;
        });

        sorted.forEach(t => {
            rows.push([
                t.date || '',
                CATEGORY_LABELS[t.category] || t.category || '',
                t.description || '',
                PAYMENT_LABELS[t.paymentMethod] || t.paymentMethod || '',
                CLASS_LABELS[t.classification] || t.classification || '',
                parseFloat(t.value) || 0,
                t.status === 'pago' ? 'Pago' : 'Pendente'
            ]);
        });

        /* ---- Create workbook ---- */
        const ws = XLSX.utils.aoa_to_sheet(rows);

        /* Column widths */
        ws['!cols'] = [
            { wch: 20 }, { wch: 18 }, { wch: 30 },
            { wch: 22 }, { wch: 25 }, { wch: 16 }, { wch: 12 }
        ];

        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, monthName.substring(0, 31));

        /* ---- Download ---- */
        const filename = `controle-financeiro-${monthKey}.xlsx`;
        XLSX.writeFile(wb, filename);
    }

    /* ---------- PDF ---------- */
    function exportPDF(monthData, totals, monthKey, monthName) {
        if (typeof window.jspdf === 'undefined') {
            alert('Biblioteca de PDF não carregou. Verifique sua conexão com a internet e recarregue a página.');
            return;
        }
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF({ unit: 'pt', format: 'a4' });
        const marginX = 40;
        let y = 50;

        /* Cabeçalho */
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(20);
        doc.setTextColor(24, 24, 24);
        doc.text('Fluxy — Relatório Financeiro', marginX, y);
        y += 20;
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(12);
        doc.setTextColor(110, 110, 110);
        doc.text(monthName, marginX, y);
        y += 26;

        /* Resumo */
        doc.autoTable({
            startY: y,
            margin: { left: marginX, right: marginX },
            body: [
                ['Renda Total', fmt(totals.totalIncome)],
                ['Total Gasto', fmt(totals.totalSpent)],
                ['Pendente', fmt(totals.totalPending)],
                ['Sobra Atual', fmt(totals.remaining)]
            ],
            theme: 'plain',
            styles: { fontSize: 11, cellPadding: 4 },
            columnStyles: {
                0: { fontStyle: 'bold', textColor: [95, 95, 95] },
                1: { halign: 'right', fontStyle: 'bold', textColor: [24, 24, 24] }
            }
        });
        y = doc.lastAutoTable.finalY + 24;

        /* Orçamento por faixa */
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(13);
        doc.setTextColor(24, 24, 24);
        doc.text(`Orçamento ${totals.essentialPct}/${totals.lifestylePct}/${totals.investmentPct}`, marginX, y);
        y += 8;

        const pctUsed = (spent, budget) => budget > 0 ? ((spent / budget) * 100).toFixed(1) + '%' : '0%';
        doc.autoTable({
            startY: y,
            margin: { left: marginX, right: marginX },
            head: [['Faixa', 'Gasto', 'Orçamento', '% Utilizado']],
            body: [
                [`Essencial (${totals.essentialPct}%)`, fmt(totals.essentialSpent), fmt(totals.essentialBudget), pctUsed(totals.essentialSpent, totals.essentialBudget)],
                [`Estilo de Vida (${totals.lifestylePct}%)`, fmt(totals.lifestyleSpent), fmt(totals.lifestyleBudget), pctUsed(totals.lifestyleSpent, totals.lifestyleBudget)],
                [`Investimento (${totals.investmentPct}%)`, fmt(totals.investmentSpent), fmt(totals.investmentBudget), pctUsed(totals.investmentSpent, totals.investmentBudget)]
            ],
            theme: 'striped',
            headStyles: { fillColor: [24, 24, 24] },
            styles: { fontSize: 10 }
        });
        y = doc.lastAutoTable.finalY + 24;

        /* Transações */
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(13);
        doc.setTextColor(24, 24, 24);
        doc.text('Transações', marginX, y);
        y += 8;

        const sorted = [...monthData.transactions].sort((a, b) => (a.date || '').localeCompare(b.date || ''));
        const body = sorted.map(t => [
            t.date ? t.date.split('-').reverse().join('/') : '—',
            CATEGORY_LABELS[t.category] || t.category || '',
            t.description || '',
            PAYMENT_LABELS[t.paymentMethod] || t.paymentMethod || '',
            fmt(Math.abs(parseFloat(t.value) || 0)),
            t.status === 'pago' ? 'Pago' : 'Pendente'
        ]);

        doc.autoTable({
            startY: y,
            margin: { left: marginX, right: marginX },
            head: [['Data', 'Categoria', 'Descrição', 'Pagamento', 'Valor', 'Status']],
            body,
            theme: 'striped',
            headStyles: { fillColor: [24, 24, 24] },
            styles: { fontSize: 9 },
            didParseCell: (data) => {
                if (data.section === 'body' && data.column.index === 5) {
                    data.cell.styles.textColor = data.cell.raw === 'Pago' ? [56, 150, 100] : [200, 130, 40];
                    data.cell.styles.fontStyle = 'bold';
                }
            }
        });

        /* Rodapé com paginação */
        const pageCount = doc.internal.getNumberOfPages();
        for (let i = 1; i <= pageCount; i++) {
            doc.setPage(i);
            doc.setFontSize(8);
            doc.setTextColor(160, 160, 160);
            doc.text(`Gerado por Fluxy — página ${i} de ${pageCount}`, marginX, doc.internal.pageSize.getHeight() - 20);
        }

        doc.save(`relatorio-fluxy-${monthKey}.pdf`);
    }

    return { downloadSpreadsheet, exportPDF };
})();
