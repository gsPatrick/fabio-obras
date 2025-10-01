// src/features/ExcelImport/excelImport.routes.js
const { Router } = require('express');
const excelImportController = require('./excelImport.controller');
const multer = require('multer');
const os = require('os');

const router = Router();

// Configuração do Multer para salvar temporariamente no diretório do SO
const upload = multer({ dest: os.tmpdir() });

// Rota de importação: usa o Multer para lidar com o upload de arquivo único
router.post('/excel', upload.single('file'), excelImportController.handleExcelUpload);

module.exports = router;