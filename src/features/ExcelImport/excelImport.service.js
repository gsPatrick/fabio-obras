// src/features/ExcelImport/excelImport.service.js
'use strict';

const logger = require('../../utils/logger');
const { MonitoredGroup, Category, PendingExpense, Expense } = require('../../models');
const { Op } = require('sequelize');
const aiService = require('../../utils/aiService');
const whatsappService = require('../../utils/whatsappService');
const dashboardService = require('../../features/Dashboard/dashboard.service');
const excelService = require('../../utils/excelService');
const fs = require('fs');
const path = require('path');
const { startOfMonth, format } = require('date-fns');
const XLSX = require('xlsx'); // Importar XLSX

const CONTEXT_WAIT_TIME_MINUTES = 2;
const EXPENSE_EDIT_WAIT_TIME_MINUTES = 1;

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

            // 2. BUSCAR CATEGORIAS EXISTENTES (Filtrando por perfil)
            const categories = await Category.findAll({ 
                where: { profile_id: profileId }, // <<< FILTRO CRÍTICO
                attributes: ['name', 'id'] 
            });
            const categoryList = categories.map(c => c.name);

            // 3. ENVIAR PARA A IA PARA ANÁLISE DE ESTRUTURA E EXTRAÇÃO
            logger.info('[ExcelImportService] Iniciando análise de planilha com a IA...');
            const resultJsonString = await aiService.analyzeExcelStructureAndExtractData(csvString, categoryList);
            
            // CRÍTICO: Tentar fazer o parse do JSON da IA
            const importResult = JSON.parse(resultJsonString);
            const expensesToImport = importResult.expenses;
            
            if (!expensesToImport || expensesToImport.length === 0) {
                // Se a IA falhou, lança a razão que ela forneceu
                throw new Error(importResult.reason || 'A IA não conseguiu extrair dados de despesa válidos da planilha.');
            }

            // 4. INSERIR DESPESAS NO BANCO DE DADOS
            const importedExpenses = [];
            let importCount = 0;
            
            // Mapeia categorias por nome para ID para inserção rápida
            const categoryMap = categories.reduce((map, cat) => {
                map[cat.name] = cat.id;
                return map;
            }, {});
            const otherCategoryId = categoryMap['Outros'];
            
            for (const expenseData of expensesToImport) {
                // Encontra a Category ID correspondente ao nome normalizado pela IA
                const category_id = categoryMap[expenseData.categoryName] || otherCategoryId;

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
                    logger.warn(`[ExcelImportService] Categoria 'Outros' não encontrada ou falha ao mapear. Ignorando registro.`);
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
            // Propagar a mensagem de erro (que pode vir da IA) para o controller
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