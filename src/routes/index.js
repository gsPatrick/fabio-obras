// src/routes/index.js
const { Router } = require('express');
const webhookRoutes = require('../features/WhatsappWebhook/whatsappWebhook.routes');
const groupRoutes = require('../features/GroupManager/group.routes');
const dashboardRoutes = require('../features/Dashboard/dashboard.routes');
const categoryRoutes = require('../features/CategoryManager/category.routes');
const authRoutes = require('../features/Auth/auth.routes');
const authMiddleware = require('../middleware/auth.middleware');
const authorizationMiddleware = require('../middleware/authorization.middleware'); // <<< NOVO
const userRoutes = require('../features/User/user.routes');
const profileRoutes = require('../features/ProfileManager/profile.routes');
const goalRoutes = require('../features/GoalManager/goal.routes');
const importRoutes = require('../features/ExcelImport/excelImport.routes');
const guestUserRoutes = require('../features/GuestUserManager/guestUser.routes'); // <<< NOVO
const testRoutes = require('../features/GroupManager/grou.routesteste');
const adminRoutes = require('../features/Admin/admin.routes'); // <<< NOVA IMPORTAÇÃO

const router = Router();

router.get('/', (req, res) => res.json({ status: 'online' }));

// Rotas públicas
router.use('/auth', authRoutes);
router.use('/webhook', webhookRoutes);
router.use('/payments', require('../features/Payment/payment.routes')); // Rota de Pagamento (Webhooks)
router.use('/test', testRoutes); // <<< NOVO: Registrar a rota de teste aqui

// Rotas protegidas APENAS por Token (Profiles, Users/me/status, etc.)
router.use('/profiles', profileRoutes);

// Rotas protegidas por Token E ProfileId
router.use(authMiddleware); 
router.use(authorizationMiddleware); // <<< APLICAÇÃO DO NOVO MIDDLEWARE (Checa Permissões)

router.use('/groups', groupRoutes);
router.use('/dashboard', dashboardRoutes);
router.use('/categories', categoryRoutes);
router.use('/users', userRoutes);
router.use('/goals', goalRoutes);
router.use('/import', importRoutes);
router.use('/guests', guestUserRoutes); // <<< NOVA ROTA DE GESTÃO DE CONVIDADOS
router.use('/admin', adminRoutes);

module.exports = router;