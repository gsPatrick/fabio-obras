const { Router } = require('express');
const categoryController = require('./category.controller');

const router = Router();

router.get('/', categoryController.getAll);
router.post('/', categoryController.create);

router.get('/:id', categoryController.getById);
router.put('/:id', categoryController.update);
router.delete('/:id', categoryController.delete);

module.exports = router;