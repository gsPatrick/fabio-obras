
// src/features/Auth/auth.routes.js
const { Router } = require('express');
const authController = require('./auth.controller');

const router = Router();

router.post('/login', authController.login);
router.post('/logout', authController.logout);
router.post('/register', authController.register); // <<< NOVA ROTA


module.exports = router;