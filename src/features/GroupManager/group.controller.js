
const groupService = require('./group.service');
const logger = require('../../utils/logger');

class GroupController {
  async listAvailableGroups(req, res) {
    try {
      const groups = await groupService.listAllGroupsFromWhatsapp();
      res.status(200).json(groups);
    } catch (error) {
      logger.error('[GroupController] Erro ao listar grupos:', error.message);
      res.status(500).json({ error: 'Não foi possível buscar os grupos.' });
    }
  }

  async monitorGroup(req, res) {
    const { groupId } = req.body;
    try {
      const result = await groupService.startMonitoringGroup(groupId);
      res.status(201).json(result);
    } catch (error) {
      logger.error('[GroupController] Erro ao iniciar monitoramento:', error.message);
      res.status(400).json({ error: error.message });
    }
  }
}

module.exports = new GroupController();