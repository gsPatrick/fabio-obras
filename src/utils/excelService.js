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

    // Define as colunas do Excel
    worksheet.columns = [
      { header: 'ID', key: 'id', width: 10 },
      { header: 'Valor', key: 'value', width: 15 },
      { header: 'Descrição', key: 'description', width: 40 },
      { header: 'Data', key: 'expense_date', width: 20 },
      { header: 'Categoria', key: 'category_name', width: 25 },
    ];

    // Adiciona as linhas com os dados das despesas
    expenses.forEach(expense => {
      worksheet.addRow({
        id: expense.id,
        value: parseFloat(expense.value), // Garante que seja um número para formatação
        description: expense.description,
        expense_date: new Date(expense.expense_date).toLocaleString('pt-BR'), // Formata a data
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

    // Salva o workbook em um arquivo temporário
    const tempFilePath = path.join(os.tmpdir(), `relatorio_despesas_${Date.now()}.xlsx`);
    await workbook.xlsx.writeFile(tempFilePath);
    
    logger.info(`[ExcelService] Arquivo Excel gerado em: ${tempFilePath}`);
    return tempFilePath;
  }
}

module.exports = new ExcelService();