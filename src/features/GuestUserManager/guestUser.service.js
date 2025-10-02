// src/features/GuestUserManager/guestUser.service.js
const { GuestUser, GuestPermission, Profile, User, sequelize } = require('../../models');
const logger = require('../../utils/logger');
const { Op } = require('sequelize');

class GuestUserService {

    /**
     * Valida se o usuário logado é o DONO do perfil.
     */
    async _checkProfileOwnership(profileId, userId) {
        const profile = await Profile.findByPk(profileId);
        if (!profile || profile.user_id !== userId) {
            throw new Error('Acesso negado. Você não é o dono deste perfil.');
        }
        return profile;
    }

    /**
     * Cria um novo usuário convidado e suas permissões.
     */
    async createGuestUser(profileId, ownerId, data) {
        await this._checkProfileOwnership(profileId, ownerId); // Apenas o dono pode convidar

        const { email, permissions } = data;
        
        // 1. Verificar se já existe um convidado pendente/ativo com este email para este perfil
        const existingGuest = await GuestUser.findOne({
            where: { profile_id: profileId, email },
        });

        if (existingGuest && existingGuest.status !== 'revoked') {
            throw new Error(`O usuário ${email} já está como '${existingGuest.status}' neste perfil.`);
        }
        
        // 2. Transação para garantir que Convidado e Permissões sejam criados juntos
        return sequelize.transaction(async (t) => {
            const guest = await GuestUser.create({
                profile_id: profileId,
                email: email,
                status: 'pending', // Novo convite é sempre pendente
                invitation_token: require('crypto').randomBytes(20).toString('hex'), // Token simples
            }, { transaction: t });

            // 3. Criar permissões
            await GuestPermission.create({
                guest_user_id: guest.id,
                ...permissions,
                // Garantir que a permissão de edição seja no máximo a permissão de acesso
                can_access_expenses: permissions.can_access_expenses || permissions.can_edit_or_delete_expense,
            }, { transaction: t });
            
            // NOTE: A URL de convite real (com envio de e-mail) não está implementada,
            // mas o token está salvo para a próxima etapa.

            return guest;
        });
    }

    /**
     * Lista todos os usuários convidados de um perfil.
     */
    async listGuestUsers(profileId, ownerId) {
        await this._checkProfileOwnership(profileId, ownerId); // Apenas o dono pode listar

        return GuestUser.findAll({
            where: { profile_id: profileId },
            include: [
                { model: GuestPermission, as: 'permissions' },
                { model: User, as: 'invitedUser', attributes: ['id', 'email'] }
            ],
            order: [['createdAt', 'ASC']]
        });
    }

    /**
     * Atualiza as permissões e o status de um convidado.
     */
    async updateGuestUser(guestId, profileId, ownerId, data) {
        await this._checkProfileOwnership(profileId, ownerId); // Apenas o dono pode editar
        
        const guest = await GuestUser.findOne({ 
            where: { id: guestId, profile_id: profileId },
            include: [{ model: GuestPermission, as: 'permissions' }]
        });

        if (!guest) throw new Error('Convidado não encontrado.');
        
        const { status, permissions } = data;
        
        return sequelize.transaction(async (t) => {
            // 1. Atualizar status (se fornecido)
            if (status) {
                await guest.update({ status }, { transaction: t });
            }
            
            // 2. Atualizar permissões (se fornecidas)
            if (permissions && guest.permissions) {
                await guest.permissions.update({
                    ...permissions,
                    can_access_expenses: permissions.can_access_expenses || permissions.can_edit_or_delete_expense,
                }, { transaction: t });
            }

            return guest;
        });
    }

    /**
     * Remove (revoga/deleta) um usuário convidado.
     */
    async deleteGuestUser(guestId, profileId, ownerId) {
        await this._checkProfileOwnership(profileId, ownerId); // Apenas o dono pode deletar
        
        const guest = await GuestUser.findOne({ 
            where: { id: guestId, profile_id: profileId }
        });

        if (!guest) throw new Error('Convidado não encontrado.');
        
        // As permissões devem ser deletadas em CASCADE no banco de dados.
        // Se a FK não tiver ON DELETE CASCADE, esta operação falhará no banco.
        await guest.destroy();
    }
}

module.exports = new GuestUserService();