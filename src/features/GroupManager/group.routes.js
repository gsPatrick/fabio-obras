const { Router } = require('express');
const groupController = require('./group.controller');

const router = Router();

// Rota para listar todos os grupos disponíveis na instância
router.get('/', groupController.listAvailableGroups);

// Rota para começar a monitorar um grupo específico
router.post('/', groupController.monitorGroup);

router.get('/all-groups', groupController.listAllUnprotected);

module.exports = router;