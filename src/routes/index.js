// src/routes/index.js
const { Router } = require('express');
const webhookRoutes = require('../features/WhatsappWebhook/whatsappWebhook.routes');
const groupRoutes = require('../features/GroupManager/group.routes');
const dashboardRoutes = require('../features/Dashboard/dashboard.routes');
const categoryRoutes = require('../features/CategoryManager/category.routes');
const authRoutes = require('../features/Auth/auth.routes'); // <<< IMPORTAR
const authMiddleware = require('../middleware/auth.middleware'); // <<< IMPORTAR
const userRoutes = require('../features/User/user.routes'); // <<< IMPORTAR

const router = Router();

router.get('/', (req, res) => res.json({ status: 'online' }));

// Rotas públicas
router.use('/auth', authRoutes);
router.use('/webhook', webhookRoutes);

// Rotas protegidas
router.use('/groups',  groupRoutes);
router.use('/dashboard', authMiddleware, dashboardRoutes);
router.use('/categories', categoryRoutes);
router.use('/users', authMiddleware, userRoutes); // <<< ADICIONAR
module.exports = router;
