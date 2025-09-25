const { Router } = require('express');
const webhookRoutes = require('../features/WhatsappWebhook/whatsappWebhook.routes');

const router = Router();

/**
 * Rota principal para verificação de status da API.
 * Acessível em GET /
 */
router.get('/', (req, res) => {
  return res.json({ 
    status: 'online', 
    message: 'API de Controle de Custos de Obra está funcionando.' 
  });
});

/**
 * Agrupa todas as rotas relacionadas ao webhook da Z-API sob o prefixo '/webhook'.
 * O endpoint definido em whatsappWebhook.routes.js como POST /z-api se tornará POST /webhook/z-api.
 */
router.use('/webhook', webhookRoutes);

// Futuramente, outras rotas de features podem ser adicionadas aqui:
// const dashboardRoutes = require('../features/Dashboard/dashboard.routes');
// router.use('/dashboard', dashboardRoutes);

module.exports = router;