// src/features/GuestUserManager/guestUser.routes.js
const { Router } = require('express');
const guestUserController = require('./guestUser.controller');

const router = Router();

router.post('/', guestUserController.create);
router.get('/', guestUserController.findAll);
router.put('/:id', guestUserController.update);
router.delete('/:id', guestUserController.delete);

module.exports = router;