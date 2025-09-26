// src/middleware/auth.middleware.js - NOVA VERSÃO COMPLETA

const jwt = require('jsonwebtoken');
const { User } = require('../models');

module.exports = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return res.status(401).json({ error: 'Acesso negado. Nenhum token fornecido.' });
  }

  // O header vem no formato "Bearer <token>"
  // Usamos split para pegar apenas a parte do token
  const parts = authHeader.split(' ');

  if (parts.length !== 2) {
    return res.status(401).json({ error: 'Erro no formato do token.' });
  }

  const [scheme, token] = parts;

  if (!/^Bearer$/i.test(scheme)) {
    return res.status(401).json({ error: 'Token mal formatado.' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-default-secret');
    req.userId = decoded.id; // Adiciona o ID do usuário à requisição
    
    const user = await User.findByPk(req.userId);
    if (!user) {
        return res.status(401).json({ error: 'Usuário não encontrado.' });
    }

    return next();
  } catch (error) {
    return res.status(401).json({ error: 'Token inválido.' });
  }
};