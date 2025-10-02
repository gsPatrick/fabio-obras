// src/features/GuestUserManager/guestUser.routes.js
const { Router } = require('express');
const guestUserController = require('./guestUser.controller');

const router = Router();

// Rotas protegidas por authMiddleware e authorizationMiddleware (do index.js)
// A checagem de "Dono do Perfil" está no guestUser.service
router.post('/', guestUserController.create);
router.get('/', guestUserController.findAll);
router.put('/:id', guestUserController.update);
router.delete('/:id', guestUserController.delete);

module.exports = router;