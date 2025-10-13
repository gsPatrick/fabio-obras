
// src/features/CategoryManager/category.service.js

const { Category, Expense, Revenue, MonthlyGoal, sequelize } = require('../../models');
const { Op } = require('sequelize');
const { startOfMonth, endOfMonth } = require('date-fns');

class CategoryService {
  /**
   * <<< NOVO MÉTODO >>>
   * Lista todas as categorias de um perfil com o total de gastos/receitas do mês corrente e a meta.
   */
  async getAllWithSummary(profileId) {
    if (!profileId) {
      throw new Error('ID do Perfil é obrigatório.');
    }

    const now = new Date();
    const startOfCurrentMonth = startOfMonth(now);
    const endOfCurrentMonth = endOfMonth(now);

    const categories = await Category.findAll({
      where: { profile_id: profileId },
      include: [{
        model: MonthlyGoal,
        as: 'goal',
        required: false, // Left join para pegar mesmo as que não têm meta
      }],
      order: [['category_flow', 'ASC'], ['name', 'ASC']],
    });

    const categoryIds = categories.map(c => c.id);

    // Buscar totais de despesas e receitas do mês em paralelo
    const [expenseTotals, revenueTotals] = await Promise.all([
      Expense.findAll({
        where: {
          category_id: { [Op.in]: categoryIds },
          profile_id: profileId,
          expense_date: { [Op.between]: [startOfCurrentMonth, endOfCurrentMonth] },
        },
        attributes: [
          'category_id',
          [sequelize.fn('SUM', sequelize.col('value')), 'total'],
        ],
        group: ['category_id'],
        raw: true,
      }),
      Revenue.findAll({
        where: {
          category_id: { [Op.in]: categoryIds },
          profile_id: profileId,
          revenue_date: { [Op.between]: [startOfCurrentMonth, endOfCurrentMonth] },
        },
        attributes: [
          'category_id',
          [sequelize.fn('SUM', sequelize.col('value')), 'total'],
        ],
        group: ['category_id'],
        raw: true,
      }),
    ]);

    // Mapear os totais para fácil acesso
    const expenseMap = new Map(expenseTotals.map(item => [item.category_id, parseFloat(item.total)]));
    const revenueMap = new Map(revenueTotals.map(item => [item.category_id, parseFloat(item.total)]));
    
    // Combinar os dados
    return categories.map(cat => {
      const categoryJson = cat.toJSON();
      const total = cat.category_flow === 'expense' 
        ? (expenseMap.get(cat.id) || 0) 
        : (revenueMap.get(cat.id) || 0);
        
      return {
        ...categoryJson,
        current_total: total,
      };
    });
  }
  
  // ... (outros métodos do service permanecem iguais)
  async getAll(profileId, flowType = null) {
    if (!profileId) {
      throw new Error('ID do Perfil é obrigatório.');
    }
    const where = { profile_id: profileId };
    if (flowType) { // Aplica filtro de fluxo se fornecido
        where.category_flow = flowType;
    }
    return Category.findAll({ 
      where, // Usa o 'where' filtrado
      order: [['category_flow', 'ASC'], ['type', 'ASC'], ['name', 'ASC']] // Orderna também por fluxo
    });
  }
  async getById(id, profileId) {
    const category = await Category.findOne({ where: { id, profile_id: profileId } });
    if (!category) throw new Error('Categoria não encontrada ou não pertence a este perfil.');
    return category;
  }
  async create(data, profileId) {
    const { name, type, category_flow } = data; // Pega category_flow

    if (!profileId) {
        throw new Error('ID do Perfil é obrigatório para criar uma categoria.');
    }
    if (!name || !type || !category_flow) { // category_flow é obrigatório
      throw new Error('Nome, tipo e fluxo (despesa/receita) são obrigatórios.');
    }
    if (!['expense', 'revenue'].includes(category_flow)) {
        throw new Error('O fluxo da categoria deve ser "expense" ou "revenue".');
    }
    const existingCategory = await Category.findOne({ where: { name, profile_id: profileId, category_flow } });
    if (existingCategory) {
      throw new Error(`A categoria '${name}' (${category_flow === 'expense' ? 'Despesa' : 'Receita'}) já existe neste perfil.`);
    }

    return Category.create({ name, type, category_flow, profile_id: profileId }); // Salva category_flow
  }
  async update(id, data, profileId) {
    const category = await this.getById(id, profileId);
    
    if ( (data.name && data.name !== category.name) || (data.category_flow && data.category_flow !== category.category_flow) ) {
      const existingCategory = await Category.findOne({ 
          where: { 
              name: data.name || category.name, 
              profile_id: profileId,
              category_flow: data.category_flow || category.category_flow
          } 
      });
      if (existingCategory && existingCategory.id !== id) {
        throw new Error(`O nome de categoria '${data.name || category.name}' com fluxo '${data.category_flow || category.category_flow}' já está em uso neste perfil.`);
      }
    }
    if (data.category_flow && data.category_flow !== category.category_flow) {
        const hasExpenses = await Expense.count({ where: { category_id: id } });
        const hasRevenues = await Revenue.count({ where: { category_id: id } });
        if (hasExpenses > 0 || hasRevenues > 0) {
            throw new Error('Não é possível alterar o fluxo de uma categoria que já possui lançamentos.');
        }
    }

    await category.update(data);
    return category;
  }
  async delete(id, profileId) {
    const category = await this.getById(id, profileId);
    
    const hasExpenses = await Expense.count({ where: { category_id: id } });
    const hasRevenues = await Revenue.count({ where: { category_id: id } });
    const hasGoals = await MonthlyGoal.count({ where: { category_id: id } });

    if (hasExpenses > 0 || hasRevenues > 0 || hasGoals > 0) {
        throw new Error('Não é possível deletar esta categoria pois existem lançamentos (despesas/receitas) ou metas vinculadas a ela.');
    }

    await category.destroy();
    return { message: 'Categoria deletada com sucesso.' };
  }
}

module.exports = new CategoryService();