// src/features/GoalManager/goal.controller.js
const goalService = require('./goal.service');
const logger = require('../../utils/logger');

class GoalController {
  
  // POST /goals
  async createOrUpdate(req, res) {
    try {
      const { value, categoryId, isTotalGoal } = req.body;
      
      const { goal, created } = await goalService.createOrUpdateGoal(req.profileId, { value, categoryId, isTotalGoal });
      
      res.status(created ? 201 : 200).json({ 
          message: created ? 'Meta criada com sucesso.' : 'Meta atualizada com sucesso.',
          goal 
      });
    } catch (error) {
      logger.error('[GoalController] Erro ao criar/atualizar meta:', error.message);
      res.status(400).json({ error: error.message });
    }
  }

  // GET /goals
  async findAll(req, res) {
    try {
      const goals = await goalService.getAllGoalsByProfile(req.profileId);
      res.status(200).json(goals);
    } catch (error) {
      logger.error('[GoalController] Erro ao listar metas:', error.message);
      res.status(500).json({ error: error.message });
    }
  }

  // DELETE /goals/:id
  async delete(req, res) {
    try {
      const result = await goalService.deleteGoal(req.params.id, req.profileId);
      res.status(200).json(result);
    } catch (error) {
      logger.error('[GoalController] Erro ao deletar meta:', error.message);
      res.status(404).json({ error: error.message });
    }
  }
}

module.exports = new GoalController();