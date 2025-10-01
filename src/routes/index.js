// src/routes/index.js (Versão Corrigida)

const { Router } = require('express');
const webhookRoutes = require('../features/WhatsappWebhook/whatsappWebhook.routes');
const groupRoutes = require('../features/GroupManager/group.routes');
const dashboardRoutes = require('../features/Dashboard/dashboard.routes');
const categoryRoutes = require('../features/CategoryManager/category.routes');
const authRoutes = require('../features/Auth/auth.routes');
const authMiddleware = require('../middleware/auth.middleware'); // Middleware principal (verifica token/profileId)
const userRoutes = require('../features/User/user.routes');
const profileRoutes = require('../features/ProfileManager/profile.routes'); // <<< IMPORTADO
const goalRoutes = require('../features/GoalManager/goal.routes');
const importRoutes = require('../features/ExcelImport/excelImport.routes');
const paymentRoutes = require('../features/Payment/payment.routes'); // <<< NOVO

const router = Router();

router.get('/', (req, res) => res.json({ status: 'online' }));

// Rotas públicas
router.use('/auth', authRoutes);
router.use('/webhook', webhookRoutes);
router.use('/payments', paymentRoutes); // <<< ADICIONAR

// Rotas protegidas APENAS por Token (Profiles)
// O profileRoutes agora aplica o authMiddleware internamente, sem verificar profileId
router.use('/profiles', profileRoutes); // <<< LINHA 23: Aqui estava o erro, mas a importação estava correta

// Rotas protegidas por Token E ProfileId
// Aplica o middleware principal (que verifica token E profileId) para TUDO que vier depois
router.use(authMiddleware); 

router.use('/groups', groupRoutes);
router.use('/dashboard', dashboardRoutes);
router.use('/categories', categoryRoutes);
router.use('/users', userRoutes);
router.use('/goals', goalRoutes);
router.use('/import', importRoutes);

module.exports = router;