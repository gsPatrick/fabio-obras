// src/features/GuestUserManager/guestUser.controller.js (Versão Corrigida)
const guestUserService = require('./guestUser.service');
const logger = require('../../utils/logger');

class GuestUserController {
    
    // POST /guests (Cria Convite)
    create = async (req, res) => { // <<< Usar arrow function com atribuição garante o 'this' em instâncias
        const { email, permissions } = req.body;
        const profileId = req.profileId; 
        const ownerId = req.userId; 
        
        if (!email || !permissions) {
            return res.status(400).json({ error: 'Email e permissões são obrigatórios.' });
        }

        try {
            const guest = await guestUserService.createGuestUser(profileId, ownerId, { email, permissions });
            
            res.status(201).json({ 
                message: `Convite enviado (e-mail não implementado). Token: ${guest.invitation_token}`, 
                guest 
            });
        } catch (error) {
            logger.error('[GuestUserController] Erro ao criar convidado:', error);
            res.status(403).json({ error: error.message });
        }
    }

    // GET /guests (Lista Convidados)
    findAll = async (req, res) => {
        const profileId = req.profileId;
        const ownerId = req.userId;
        
        try {
            const guests = await guestUserService.listGuestUsers(profileId, ownerId);
            res.status(200).json(guests);
        } catch (error) {
            logger.error('[GuestUserController] Erro ao listar convidados:', error);
            res.status(403).json({ error: error.message });
        }
    }

    // PUT /guests/:id (Atualiza Permissões/Status)
    update = async (req, res) => {
        const { id } = req.params;
        const profileId = req.profileId;
        const ownerId = req.userId;
        
        try {
            const guest = await guestUserService.updateGuestUser(id, profileId, ownerId, req.body);
            res.status(200).json(guest);
        } catch (error) {
            logger.error('[GuestUserController] Erro ao atualizar convidado:', error);
            res.status(403).json({ error: error.message });
        }
    }

    // DELETE /guests/:id (Remove Convite)
    delete = async (req, res) => {
        const { id } = req.params;
        const profileId = req.profileId;
        const ownerId = req.userId;
        
        try {
            await guestUserService.deleteGuestUser(id, profileId, ownerId);
            res.status(200).json({ message: 'Convidado removido com sucesso.' });
        } catch (error) {
            logger.error('[GuestUserController] Erro ao remover convidado:', error);
            res.status(403).json({ error: error.message });
        }
    }
}

module.exports = new GuestUserController(); // Exporta a instância