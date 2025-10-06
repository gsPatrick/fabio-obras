// src/features/GroupManager/group.controller.js

const groupService = require('./group.service');
const groupManagerService = require('../../utils/GroupManagerService');
const logger = require('../../utils/logger');

class GroupController {
  async listAvailableGroups(req, res) {
    try {
      // Nota: Não é necessário userId ou profileId para listar grupos da Z-API,
      // mas a rota está protegida por authMiddleware para garantir a autenticação.
      const groups = await groupService.listAllGroupsFromWhatsapp();
      res.status(200).json(groups);
    } catch (error) {
      logger.error('[GroupController] Erro ao listar grupos:', error.message);
      res.status(500).json({ error: 'Não foi possível buscar os grupos.' });
    }
  }

    // ===================================================================
  // <<< NOVO MÉTODO DE TESTE (PÚBLICO) >>>
  // ===================================================================
  async listAllUnprotected(req, res) {
    try {
      // Chama diretamente o serviço de cache para obter todos os grupos, sem filtros
      const groups = await groupManagerService.getAllGroupsFromCache();
      res.status(200).json(groups);
    } catch (error) {
      logger.error('[GroupController] Erro ao listar todos os grupos (unprotected):', error.message);
      res.status(500).json({ error: 'Não foi possível buscar a lista completa de grupos.' });
    }
  }

  async monitorGroup(req, res) {
    const { groupId } = req.body;
    const profileId = req.profileId; 
    const userId = req.userId; 

    try {
      const result = await groupService.startMonitoringGroup(groupId, profileId, userId); 
      res.status(201).json(result);
    } catch (error) {
      logger.error('[GroupController] Erro ao iniciar monitoramento:', error.message);
      
      if (error.message.includes('Acesso negado')) {
        return res.status(403).json({ error: error.message });
      }
      res.status(400).json({ error: error.message });
    }
  }

   async listAvailableGroups(req, res) {
    const userId = req.userId; // <<< Pegar o userId do middleware
    try {
      // CRÍTICO: Chamar a nova função de filtragem
      const groups = await groupService.listUserGroups(userId); 
      res.status(200).json(groups);
    } catch (error) {
      logger.error('[GroupController] Erro ao listar grupos:', error.message);
      // Retorna 400 se o número de telefone não foi configurado (regra de validação)
      if (error.message.includes('O número de WhatsApp do seu perfil é obrigatório')) {
         return res.status(400).json({ error: error.message });
      }
      res.status(500).json({ error: 'Não foi possível buscar os grupos.' });
    }
  }

}

module.exports = new GroupController();