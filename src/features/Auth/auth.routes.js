// src/features/Auth/auth.routes.js
const { Router } = require('express');
const authController = require('./auth.controller');

const router = Router();

router.post('/login', authController.login);
router.post('/logout', authController.logout);
router.post('/register', authController.register);

// <<< NOVA ROTA >>>
// Recebe um token temporário e a nova senha para ativar o usuário
router.post('/complete-registration', authController.completeRegistration);


module.exports = router;