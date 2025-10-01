// src/features/GoalManager/goal.routes.js
const { Router } = require('express');
const goalController = require('./goal.controller');

const router = Router();

router.post('/', goalController.createOrUpdate);
router.get('/', goalController.findAll);
router.delete('/:id', goalController.delete);

module.exports = router;