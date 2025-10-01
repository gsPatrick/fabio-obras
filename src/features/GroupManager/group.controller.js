// src/features/GroupManager/group.controller.js

const groupService = require('./group.service');
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

  async monitorGroup(req, res) {
    const { groupId } = req.body;
    const profileId = req.profileId; 
    const userId = req.userId; // CRÍTICO: Pegar o ID do usuário do middleware

    try {
      const result = await groupService.startMonitoringGroup(groupId, profileId, userId); // PASSAR userId
      res.status(201).json(result);
    } catch (error) {
      logger.error('[GroupController] Erro ao iniciar monitoramento:', error.message);
      
      // Retorna 403 se for erro de plano (ou outra restrição de acesso)
      if (error.message.includes('Acesso negado')) {
        return res.status(403).json({ error: error.message });
      }
      res.status(400).json({ error: error.message });
    }
  }
}

module.exports = new GroupController();