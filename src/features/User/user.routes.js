// src/features/User/user.routes.js
const { Router } = require('express');
const userController = require('./user.controller');

const router = Router();

router.get('/me', userController.getMe);
router.put('/me', userController.updateMe);

module.exports = router;