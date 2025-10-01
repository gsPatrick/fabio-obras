// src/features/ExcelImport/excelImport.service.js
const { Expense, Category } = require('../../models');
const logger = require('../../utils/logger');
const aiService = require('../../utils/aiService');
const XLSX = require('xlsx');
const fs = require('fs');

class ExcelImportService {
    /**
     * Lê uma planilha e usa a IA para interpretar as colunas e extrair os dados de despesa.
     * @param {string} filePath - Caminho do arquivo XLSX.
     * @param {number} profileId - ID do perfil que está importando.
     * @returns {Promise<object>} - Relatório de despesas importadas.
     */
    async importExpensesFromExcel(filePath, profileId) {
        let workbook;
        try {
            // 1. LER O ARQUIVO XLSX
            logger.info(`[ExcelImportService] Lendo arquivo XLSX: ${filePath}`);
            workbook = XLSX.readFile(filePath);
            const sheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[sheetName];
            
            // Converte a planilha para CSV String (Melhor para a IA interpretar a estrutura)
            const csvString = XLSX.utils.sheet_to_csv(worksheet, { FS: '|' }); // Usar pipe '|' como separador
            
            if (csvString.length === 0) {
                throw new Error('Planilha vazia ou ilegível.');
            }

            // 2. BUSCAR CATEGORIAS EXISTENTES
            const categories = await Category.findAll({ attributes: ['name', 'id'] });
            const categoryList = categories.map(c => c.name);

            // 3. ENVIAR PARA A IA PARA ANÁLISE DE ESTRUTURA E EXTRAÇÃO
            logger.info('[ExcelImportService] Iniciando análise de planilha com a IA...');
            const resultJsonString = await aiService.analyzeExcelStructureAndExtractData(csvString, categoryList);
            
            const importResult = JSON.parse(resultJsonString);
            const expensesToImport = importResult.expenses;
            
            if (!expensesToImport || expensesToImport.length === 0) {
                throw new Error(importResult.reason || 'A IA não conseguiu extrair dados de despesa válidos da planilha.');
            }

            // 4. INSERIR DESPESAS NO BANCO DE DADOS
            const importedExpenses = [];
            let importCount = 0;
            
            for (const expenseData of expensesToImport) {
                // Encontra a Category ID correspondente ao nome normalizado pela IA
                const matchingCategory = categories.find(c => c.name === expenseData.categoryName);
                const category_id = matchingCategory?.id || categories.find(c => c.name === 'Outros')?.id;

                if (category_id) {
                    const newExpense = await Expense.create({
                        profile_id: profileId,
                        value: expenseData.value,
                        description: expenseData.description,
                        expense_date: new Date(expenseData.date), // O formato ISO deve funcionar
                        category_id: category_id,
                        whatsapp_message_id: null, // Importação manual
                    });
                    importedExpenses.push(newExpense);
                    importCount++;
                } else {
                    logger.warn(`[ExcelImportService] Categoria não encontrada para: ${expenseData.categoryName}. Ignorando registro.`);
                }
            }
            
            logger.info(`[ExcelImportService] Importação concluída. ${importCount} despesas importadas para o Perfil ${profileId}.`);
            return { 
                count: importCount, 
                firstExpenseDate: expensesToImport[0]?.date, 
                lastExpenseDate: expensesToImport[expensesToImport.length - 1]?.date
            };

        } catch (error) {
            logger.error('[ExcelImportService] Erro no processamento da importação de Excel:', error.message);
            throw new Error(`Falha na importação: ${error.message}`);
        } finally {
            // Garante que o arquivo temporário seja deletado
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
            }
        }
    }
}

module.exports = new ExcelImportService();