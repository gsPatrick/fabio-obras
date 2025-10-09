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

// <<< NOVAS ROTAS DE CRUD DE USUÁRIO >>>
router.post('/users', adminController.createUser); // Criar novo usuário
router.put('/users/:id', adminController.updateUser); // Atualizar usuário
router.delete('/users/:id', adminController.deleteUser); // Deletar usuário
router.put('/users/:id/subscription/status', adminController.updateUserSubscriptionStatus);

module.exports = router;