// src/middleware/authorization.middleware.js - CORRIGIDO

const { GuestUser, GuestPermission } = require('../models');
const logger = require('../utils/logger');

// Mapeamento de rotas para o campo de permissão
const PERMISSION_MAP = {
    // Rotas de Módulos (checam se o usuário tem acesso visual)
    '/dashboard': 'can_access_dashboard',
    '/categories': 'can_access_categories',
    '/reports': 'can_access_reports',
    '/expenses': 'can_access_expenses',
};

// Rotas que não precisam de checagem de permissão (pois o authMiddleware já checou o JWT)
// Elas são usadas para obter informações de usuário ou rotas de CRUD que o Dono do Perfil DEVE ter acesso
const AUTHORIZATION_EXCEPTIONS = [
    '/users/me', // Para o Front-end obter os dados do usuário
    '/users/me/subscription', // Para o Front-end checar o status do plano
    '/groups', // A lista de grupos é necessária para a tela de monitoramento
    '/goals', // O dono do perfil deve poder gerenciar metas
    '/import', // O dono do perfil deve poder importar
];

module.exports = async (req, res, next) => {
    const { userId, profileId } = req;
    // Pega a URL base (sem query params)
    const originalUrl = req.originalUrl.split('?')[0];

    // 1. CHECAGEM DE EXCEÇÃO: Permite a passagem sem checar profileId/permissão
    // Verifica se a URL começa com alguma das exceções
    if (AUTHORIZATION_EXCEPTIONS.some(path => originalUrl.startsWith(path))) {
        return next();
    }
    
    // CRÍTICO: Se a rota PRECISA de autorização granular, o profileId deve existir.
    if (!profileId) {
         logger.error(`[AUTHZ] Falha de estrutura: profileId é indefinido para rota protegida (${originalUrl}).`);
         return res.status(403).json({ error: 'Acesso negado. ProfileId não encontrado no Header.' });
    }
    
    // Usar req.app.locals.models para evitar problemas de importação cíclica
    const { Profile } = req.app.locals.models;

    // 2. CHECAGEM DE DONO DO PERFIL (Full Access)
    const profile = await Profile.findByPk(profileId);
    
    if (profile && profile.user_id === userId) {
        req.isProfileOwner = true; // Flag para uso futuro
        return next();
    }
    
    // 3. CHECAGEM DE CONVIDADO
    const { GuestUser, GuestPermission } = req.app.locals.models;
    const guestUser = await GuestUser.findOne({
        where: { profile_id: profileId, invited_user_id: userId, status: 'active' },
        include: [{ model: GuestPermission, as: 'permissions' }]
    });

    if (!guestUser || !guestUser.permissions) {
        logger.warn(`[AUTHZ] Acesso negado. Usuário ${userId} não é dono e nem convidado ativo para o Perfil ${profileId}.`);
        return res.status(403).json({ error: 'Acesso negado. Você não tem permissão para este perfil.' });
    }
    
    // 4. CHECAGEM DE PERMISSÃO POR ROTA
    for (const [route, permissionField] of Object.entries(PERMISSION_MAP)) {
        if (originalUrl.startsWith(route)) {
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
    
    // Padrão de segurança: se é um convidado ativo, e a rota não está no PERMISSION_MAP, permite (ex: /guests, rotas utilitárias)
    req.guestPermissions = guestUser.permissions;
    return next();
};