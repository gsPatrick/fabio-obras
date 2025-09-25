const { Router } = require('express');
const webhookRoutes = require('../features/WhatsappWebhook/whatsappWebhook.routes');
const groupRoutes = require('../features/GroupManager/group.routes');
const dashboardRoutes = require('../features/Dashboard/dashboard.routes'); // <<< IMPORTAR
const categoryRoutes = require('../features/CategoryManager/category.routes'); // <<< IMPORTAR

const router = Router();

router.get('/', (req, res) => res.json({ status: 'online' }));

router.use('/webhook', webhookRoutes);
router.use('/groups', groupRoutes);
router.use('/dashboard', dashboardRoutes); // <<< ADICIONAR
router.use('/categories', categoryRoutes); // <<< ADICIONAR

module.exports = router;