// src/features/User/user.routes.js
const { Router } = require('express');
const userController = require('./user.controller');

const router = Router();

router.get('/me', userController.getMe);
router.put('/me', userController.updateMe);

// NOVO: Rota para checar o status de assinatura
router.get('/me/subscription/status', userController.getSubscriptionStatus);

module.exports = router;