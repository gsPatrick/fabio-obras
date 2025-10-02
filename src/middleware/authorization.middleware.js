// src/middleware/authorization.middleware.js - NOVO

const { GuestUser, GuestPermission } = require('../models');
const logger = require('../utils/logger');

// Mapeamento de rotas para o campo de permissão
const PERMISSION_MAP = {
    '/dashboard': 'can_access_dashboard',
    '/categories': 'can_access_categories',
    '/reports': 'can_access_reports',
    '/expenses': 'can_access_expenses',
    // Permissões de ação (adicionar/editar) serão checadas no Controller/Service
};

module.exports = async (req, res, next) => {
    const { userId, profileId } = req;
    
    // CRÍTICO: Se o usuário é o DONO DO PERFIL, ele tem TODAS as permissões.
    // Primeiro, checar se o userId é o dono do profileId
    const { Profile } = req.app.locals.models;
    const profile = await Profile.findByPk(profileId);
    
    if (profile && profile.user_id === userId) {
        // Usuário é o dono do perfil
        req.isProfileOwner = true; // Flag para uso futuro
        return next();
    }
    
    // Se não for o dono, ele deve ser um convidado ATIVO
    const guestUser = await GuestUser.findOne({
        where: { profile_id: profileId, invited_user_id: userId, status: 'active' },
        include: [{ model: GuestPermission, as: 'permissions' }]
    });

    if (!guestUser || !guestUser.permissions) {
        logger.warn(`[AUTHZ] Acesso negado. Usuário ${userId} não é dono e nem convidado ativo para o Perfil ${profileId}.`);
        return res.status(403).json({ error: 'Acesso negado. Você não tem permissão para este perfil.' });
    }
    
    // Checagem de permissão por rota
    const requestedPath = req.originalUrl.split('?')[0];
    
    for (const [route, permissionField] of Object.entries(PERMISSION_MAP)) {
        if (requestedPath.startsWith(route)) {
            // Se a permissão específica estiver desativada, nega o acesso
            if (!guestUser.permissions[permissionField]) {
                logger.warn(`[AUTHZ] Acesso negado. Usuário ${userId} não tem permissão para a rota ${route}.`);
                return res.status(403).json({ error: `Acesso negado. Permissão para o módulo de ${route.substring(1)} é necessária.` });
            }
            // Se a permissão estiver ativada, prossegue
            req.guestPermissions = guestUser.permissions; // Anexa as permissões
            return next();
        }
    }
    
    // Se chegou até aqui (ex: rota /groups), e é um convidado ativo, o acesso é concedido (padrão de segurança)
    req.guestPermissions = guestUser.permissions;
    return next();
};