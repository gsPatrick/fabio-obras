// src/features/Dashboard/dashboard.routes.js
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
router.get('/revenues', dashboardController.getDetailedRevenues); // <<< NOVO
router.put('/revenues/:id', dashboardController.updateRevenue);     // <<< NOVO
router.delete('/revenues/:id', dashboardController.deleteRevenue);   // <<< NOVO

// <<< NOVO: Rotas para Fatura de Cartão de Crédito >>>
// Ex: /dashboard/credit-card-invoice?creditCardId=1&month=10&year=2025
router.get('/credit-card-invoice', dashboardController.getCreditCardInvoice);
// <<< FIM NOVO >>>

module.exports = router;