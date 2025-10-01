// src/routes/index.js
const { Router } = require('express');
const webhookRoutes = require('../features/WhatsappWebhook/whatsappWebhook.routes');
const groupRoutes = require('../features/GroupManager/group.routes');
const dashboardRoutes = require('../features/Dashboard/dashboard.routes');
const categoryRoutes = require('../features/CategoryManager/category.routes');
const authRoutes = require('../features/Auth/auth.routes');
const authMiddleware = require('../middleware/auth.middleware');
const userRoutes = require('../features/User/user.routes');
const profileRoutes = require('../features/ProfileManager/profile.routes'); // <<< IMPORTAR
const goalRoutes = require('../features/GoalManager/goal.routes'); // <<< IMPORTAR
const importRoutes = require('../features/ExcelImport/excelImport.routes'); // <<< IMPORTAR

const router = Router();

router.get('/', (req, res) => res.json({ status: 'online' }));

// Rotas públicas
router.use('/auth', authRoutes);
router.use('/webhook', webhookRoutes); // O Webhook precisa ser público para a Z-API

// Rotas protegidas (todas exigem o header X-Profile-Id agora, exceto /profiles)
router.use('/profiles', profileRoutes); // NÃO aplica o middleware aqui, pois ele é aplicado internamente na rota.
router.use(authMiddleware); // Aplica o middleware de autenticação (e verificação de profileId)

router.use('/groups', groupRoutes);
router.use('/dashboard', dashboardRoutes);
router.use('/categories', categoryRoutes);
router.use('/users', userRoutes);
router.use('/goals', goalRoutes); // <<< ADICIONAR
router.use('/import', importRoutes); // <<< ADICIONAR

module.exports = router;