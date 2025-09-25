const { Router } = require('express');
const webhookRoutes = require('../features/WhatsappWebhook/whatsappWebhook.routes');
const groupRoutes = require('../features/GroupManager/group.routes'); // <<< IMPORTAR

const router = Router();

router.get('/', (req, res) => res.json({ status: 'online', message: 'API funcionando.' }));

router.use('/webhook', webhookRoutes);
router.use('/groups', groupRoutes); // <<< ADICIONAR

module.exports = router;