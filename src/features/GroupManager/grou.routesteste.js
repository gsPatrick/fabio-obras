const { Router } = require('express');
const groupController = require('./group.controller');

const router = Router();

router.get('/all-groups', groupController.listAllUnprotected);

module.exports = router;