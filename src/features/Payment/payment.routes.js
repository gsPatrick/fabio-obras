// src/features/Payment/payment.routes.js
const { Router } = require('express');
const paymentController = require('./payment.controller');
const authMiddleware = require('../../middleware/auth.middleware');

const router = Router();

// Webhook do Mercado Pago (sem autenticação)
router.post("/webhook", paymentController.webhook);

// Rotas protegidas (exige JWT, mas NÃO profileId, pois é pago por User)
router.post("/checkout/subscription", authMiddleware, paymentController.createSubscriptionCheckout);

module.exports = router;