// src/features/GoalManager/goal.service.js
const { MonthlyGoal, Category } = require('../../models');

class GoalService {
  /**
   * Cria ou atualiza uma meta mensal (total ou por categoria).
   * @param {number} profileId 
   * @param {object} data - { value, categoryId, isTotalGoal }
   */
  async createOrUpdateGoal(profileId, data) {
    const { value, categoryId, isTotalGoal = false } = data;

    if (!value || isNaN(parseFloat(value))) {
      throw new Error('O valor da meta é obrigatório.');
    }
    
    // 1. Validar se a categoria existe, caso seja uma meta por categoria
    if (categoryId && !isTotalGoal) {
        const category = await Category.findByPk(categoryId);
        if (!category) {
            throw new Error(`Categoria com ID ${categoryId} não encontrada.`);
        }
    }
    
    // 2. Define os critérios de busca
    const whereClause = {
      profile_id: profileId,
      is_total_goal: isTotalGoal,
      category_id: isTotalGoal ? null : (categoryId || null),
    };

    // 3. Cria ou atualiza a meta
    const [goal, created] = await MonthlyGoal.findOrCreate({
      where: whereClause,
      defaults: {
        value: value,
        profile_id: profileId,
        category_id: whereClause.category_id,
        is_total_goal: isTotalGoal,
      },
    });

    if (!created) {
      await goal.update({ value: value });
      return { goal, created: false };
    }
    
    return { goal, created: true };
  }

  /**
   * Obtém todas as metas para o perfil (total e por categoria).
   */
  async getAllGoalsByProfile(profileId) {
    return MonthlyGoal.findAll({
      where: { profile_id: profileId },
      include: [{ model: Category, as: 'category', attributes: ['name', 'id'] }],
      order: [['is_total_goal', 'DESC'], ['value', 'DESC']],
    });
  }
  
  /**
   * Deleta uma meta pelo ID.
   */
  async deleteGoal(goalId, profileId) {
    const goal = await MonthlyGoal.findOne({ where: { id: goalId, profile_id: profileId } });
    if (!goal) throw new Error('Meta não encontrada ou não pertence ao perfil.');
    
    await goal.destroy();
    return { message: 'Meta deletada com sucesso.' };
  }
}

module.exports = new GoalService();