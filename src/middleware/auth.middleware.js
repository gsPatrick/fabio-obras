// src/middleware/auth.middleware.js - VERSÃO COM EXCEÇÕES CORRIGIDAS

const jwt = require('jsonwebtoken');
const { User, Profile } = require('../models');

module.exports = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  const profileId = req.headers['x-profile-id']; // NOVO HEADER
  const originalUrl = req.originalUrl;
  
  // Rotas que SÓ PRECISAM de JWT, mas NÃO de X-Profile-Id (Ex: buscar dados do user, listar perfis)
  const PROFILE_REQUIRED_EXCEPTIONS = [
    '/profiles',
    '/users/me'
  ];

  const requiresProfile = !PROFILE_REQUIRED_EXCEPTIONS.some(path => originalUrl.startsWith(path));

  if (!authHeader) {
    return res.status(401).json({ error: 'Acesso negado. Nenhum token fornecido.' });
  }

  const parts = authHeader.split(' ');

  if (parts.length !== 2 || !/^Bearer$/i.test(parts[0])) {
    return res.status(401).json({ error: 'Token mal formatado.' });
  }

  const token = parts[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-default-secret');
    req.userId = decoded.id; 
    
    const user = await User.findByPk(req.userId);
    if (!user) {
        return res.status(401).json({ error: 'Usuário não encontrado.' });
    }

    // ===================================================================
    // CRÍTICO: NOVO: Validação e Contexto do Perfil
    // ===================================================================
    if (requiresProfile) {
        if (!profileId) {
            return res.status(400).json({ error: 'Header X-Profile-Id obrigatório para esta operação.' });
        }

        const profile = await Profile.findOne({ where: { id: profileId, user_id: req.userId } });
        if (!profile) {
            return res.status(403).json({ error: 'Perfil inválido ou não pertence a este usuário.' });
        }
        
        req.profileId = profile.id; // Anexa o ID do perfil à requisição
    }
    // Se não for necessário (requiresProfile=false), apenas avança com req.userId
    // ===================================================================

    return next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
        return res.status(401).json({ error: 'Token inválido ou expirado.' });
    }
    return res.status(500).json({ error: 'Erro interno ao processar a autenticação.' });
  }
};