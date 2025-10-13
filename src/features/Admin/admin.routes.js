// src/features/Admin/admin.routes.js
const { Router } = require('express');
const adminController = require('./admin.controller');
const adminMiddleware = require('../../middleware/admin.middleware');

const router = Router();

// Aplica o middleware de admin a todas as rotas deste arquivo
router.use(adminMiddleware);

// Rotas de visualização
router.get('/users', adminController.getAllUsers);
router.get('/profits', adminController.getProfits);

// Rotas de CRUD de USUÁRIO
router.post('/users', adminController.createUser);
router.put('/users/:id', adminController.updateUser);
router.delete('/users/:id', adminController.deleteUser);

// Rota de CRUD de ASSINATURA (a que estava causando o erro)
router.put('/users/:id/subscription/status', adminController.updateUserSubscriptionStatus);

module.exports = router;