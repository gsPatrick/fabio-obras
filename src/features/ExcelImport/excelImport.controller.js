// src/features/ExcelImport/excelImport.controller.js
const excelImportService = require('./excelImport.service');
const logger = require('../../utils/logger');

class ExcelImportController {
  
  async handleExcelUpload(req, res) {
    const profileId = req.profileId;
    
    if (!req.file) {
      return res.status(400).json({ error: 'Nenhum arquivo de planilha enviado.' });
    }

    try {
      const result = await excelImportService.importExpensesFromExcel(req.file.path, profileId);
      
      res.status(200).json({
          message: `${result.count} despesas importadas com sucesso!`,
          data: result
      });
    } catch (error) {
      logger.error('[ExcelImportController] Erro ao importar Excel:', error.message);
      res.status(500).json({ error: error.message || 'Falha ao processar o arquivo de importação.' });
    }
  }
}

module.exports = new ExcelImportController();