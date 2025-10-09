// src/features/Admin/admin.routes.js
const { Router } = require('express');
const adminController = require('./admin.controller');
const adminMiddleware = require('../../middleware/admin.middleware');

const router = Router();

// Aplica o middleware de admin a todas as rotas deste arquivo
router.use(adminMiddleware);

router.get('/users', adminController.getAllUsers);
router.get('/profits', adminController.getProfits);

// <<< NOVA ROTA >>>
// Rota para o admin ativar/desativar a assinatura de um usuário
router.put('/users/:id/subscription/status', adminController.updateUserSubscriptionStatus);


module.exports = router;