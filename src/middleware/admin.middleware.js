// src/middleware/admin.middleware.js
const { User } = require('../models');

module.exports = async (req, res, next) => {
  try {
    const user = await User.findByPk(req.userId);
    
    // Apenas o e-mail específico do admin pode prosseguir
    if (user && user.email === 'fabio@gmail.com') {
      return next();
    }

    return res.status(403).json({ error: 'Acesso negado. Recurso disponível apenas para administradores.' });
  } catch (error) {
    return res.status(500).json({ error: 'Erro interno ao verificar permissões de administrador.' });
  }
};