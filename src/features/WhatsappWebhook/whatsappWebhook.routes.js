const { Router } = require('express');
const webhookController = require('./whatsappWebhook.controller');

const router = Router();

// Define a rota POST para receber as notificações
router.post('/z-api', webhookController.handleWebhook);

module.exports = router;