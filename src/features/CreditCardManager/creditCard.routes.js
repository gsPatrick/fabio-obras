// src/features/CreditCardManager/creditCard.routes.js
const { Router } = require('express');
const creditCardController = require('./creditCard.controller');

const router = Router();

router.post('/', creditCardController.create);
router.get('/', creditCardController.findAll);
router.get('/:id', creditCardController.findById);
router.put('/:id', creditCardController.update);
router.delete('/:id', creditCardController.delete);

module.exports = router;