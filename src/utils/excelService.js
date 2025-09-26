// src/utils/excelService.js
const ExcelJS = require('exceljs');
const fs = require('fs');
const path = require('path');
const os = require('os');
const logger = require('./logger');

class ExcelService {
  /**
   * Gera um arquivo Excel (XLSX) com a lista de despesas.
   * @param {Array<object>} expenses - Array de objetos de despesas.
   * @returns {Promise<string>} O caminho para o arquivo Excel temporário gerado.
   */
  async generateExpensesExcel(expenses) {
    logger.info('[ExcelService] Iniciando geração do arquivo Excel de despesas...');
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Despesas');

    // MUDANÇA: Remover a coluna 'ID'
    worksheet.columns = [
      { header: 'Valor', key: 'value', width: 15 },
      { header: 'Descrição', key: 'description', width: 60, style: { alignment: { wrapText: true } } },
      { header: 'Data', key: 'expense_date', width: 20 },
      { header: 'Categoria', key: 'category_name', width: 25 },
    ];

    let totalSum = 0; // Variável para acumular o total

    // Adiciona as linhas com os dados das despesas
    expenses.forEach(expense => {
      const expenseValue = parseFloat(expense.value);
      totalSum += expenseValue; // Acumula o valor

      worksheet.addRow({
        value: expenseValue,
        description: expense.description,
        // MUDANÇA: Formatar data como DD/MM/YYYY
        expense_date: new Date(expense.expense_date).toLocaleDateString('pt-BR'),
        category_name: expense.category ? expense.category.name : 'N/A',
      });
    });

    // Opcional: formatação de cabeçalho
    worksheet.getRow(1).eachCell(cell => {
      cell.font = { bold: true };
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
    });

    // Opcional: formatação da coluna de valor
    worksheet.getColumn('value').numFmt = '"R$"#,##0.00';

    // MUDANÇA: Adicionar uma linha para o valor total
    if (expenses.length > 0) {
        const totalRow = worksheet.addRow([]); // Linha vazia para espaçamento
        totalRow.getCell(1).value = 'TOTAL GERAL:';
        totalRow.getCell(1).font = { bold: true };
        totalRow.getCell(2).value = totalSum; // O valor total é na segunda coluna (antiga coluna 'value')
        totalRow.getCell(2).numFmt = '"R$"#,##0.00';
        totalRow.getCell(2).font = { bold: true };
    }


    // MUDANÇA: Nome do arquivo Excel fixo
    const tempFilePath = path.join(os.tmpdir(), `relatorio_despesas.xlsx`);
    
    await workbook.xlsx.writeFile(tempFilePath);
    
    logger.info(`[ExcelService] Arquivo Excel gerado em: ${tempFilePath}`);
    return tempFilePath;
  }
}

module.exports = new ExcelService();