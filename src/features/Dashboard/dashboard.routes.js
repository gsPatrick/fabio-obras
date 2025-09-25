const { Router } = require('express');
const dashboardController = require('./dashboard.controller');

const router = Router();

// Rotas para dados agregados
router.get('/kpis', dashboardController.getKPIs);
router.get('/charts', dashboardController.getChartData);

// Rotas para CRUD de Despesas
router.get('/expenses', dashboardController.getDetailedExpenses);
router.put('/expenses/:id', dashboardController.updateExpense);
router.delete('/expenses/:id', dashboardController.deleteExpense);

// Rotas para CRUD de Receitas
router.post('/revenues', dashboardController.createRevenue);
// (adicionar rotas GET, PUT, DELETE para receitas aqui)

module.exports = router;