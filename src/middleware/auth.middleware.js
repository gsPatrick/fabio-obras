// src/middleware/auth.middleware.js - VERSÃO COM EXCEÇÕES CORRIGIDAS

const jwt = require('jsonwebtoken');
const { User, Profile } = require('../models');

module.exports = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  const profileIdHeader = req.headers['x-profile-id']; // HEADER
  const originalUrl = req.originalUrl.split('?')[0]; // Ignora Query Params
  
  // Rotas que SÓ PRECISAM de JWT, mas NÃO de X-Profile-Id no Header
  const PROFILE_REQUIRED_EXCEPTIONS = [
    '/profiles',
    '/users/me',
    '/categories' // <<< ADICIONAR CATEGORIES
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
    // CRÍTICO: Validação e Contexto do Perfil
    // ===================================================================
    if (requiresProfile) {
        if (!profileIdHeader) {
            return res.status(400).json({ error: 'Header X-Profile-Id obrigatório para esta operação.' });
        }

        const profile = await Profile.findOne({ where: { id: profileIdHeader, user_id: req.userId } });
        if (!profile) {
            return res.status(403).json({ error: 'Perfil inválido ou não pertence a este usuário.' });
        }
        
        req.profileId = profile.id; // Anexa o ID do perfil à requisição
    } else {
        // Se é uma exceção (ex: /categories, /profiles), tenta anexar o ID do Header se existir.
        if (profileIdHeader) {
            const profile = await Profile.findOne({ where: { id: profileIdHeader, user_id: req.userId } });
            if (profile) {
                 req.profileId = profile.id; // <<< ANEXA O ID DO PERFIL PARA USO NO CONTROLLER
            }
        }
    }
    // ===================================================================

    return next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
        return res.status(401).json({ error: 'Token inválido ou expirado.' });
    }
    return res.status(500).json({ error: 'Erro interno ao processar a autenticação.' });
  }
};