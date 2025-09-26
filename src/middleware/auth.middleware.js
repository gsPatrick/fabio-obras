// src/middleware/auth.middleware.js
const jwt = require('jsonwebtoken');
const { User } = require('../models');

module.exports = async (req, res, next) => {
  const { token } = req.cookies;

  if (!token) {
    return res.status(401).json({ error: 'Acesso negado. Nenhum token fornecido.' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-default-secret');
    req.userId = decoded.id; // Adiciona o ID do usuário à requisição
    
    // Opcional: verificar se o usuário ainda existe
    const user = await User.findByPk(req.userId);
    if (!user) {
        return res.status(401).json({ error: 'Usuário não encontrado.' });
    }

    return next();
  } catch (error) {
    return res.status(401).json({ error: 'Token inválido.' });
  }
};