// src/features/ProfileManager/profile.routes.js (Versão Corrigida)
const { Router } = require('express');
const profileController = require('./profile.controller');
const authMiddleware = require('../../middleware/auth.middleware');

const router = Router();

// <<< REMOVER ESSA LINHA: router.use(authMiddleware); >>>
// Em vez disso, a rota será protegida no index.js ou a lógica de checagem do token será feita aqui sem o perfil
// Mas como o middleware de index.js é que verifica o perfil, vamos manter a lógica de checagem de Token AQUI:
// O middleware deve ser o DE AUTENTICAÇÃO PURO, não o que verifica o profileId

// NOTA: O middleware DEVE ser o que verifica APENAS o JWT e anexa req.userId, permitindo que a rota prossiga
// sem o profileId no header, pois a rota /profiles precisa ser acessível sem profileId.
// O middleware em src/middleware/auth.middleware.js já lida com isso.

router.get('/', authMiddleware, profileController.findAll);
router.post('/', authMiddleware, profileController.create);
router.put('/:id', authMiddleware, profileController.update);
router.delete('/:id', authMiddleware, profileController.delete);

module.exports = router; // O objeto Router é exportado.