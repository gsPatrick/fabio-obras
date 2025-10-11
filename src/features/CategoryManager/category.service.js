// src/features/CategoryManager/category.service.js

const { Category, Expense, Revenue, MonthlyGoal } = require('../../models'); // <<< MODIFICADO: Adicionado Expense, Revenue, MonthlyGoal

class CategoryService {
  /**
   * Lista todas as categorias pertencentes a um perfil específico.
   * @param {number} profileId - O ID do perfil do usuário logado.
   * @param {'expense' | 'revenue'} [flowType] - Opcional: filtra por fluxo (despesa/receita).
   */
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

  /**
   * Busca uma única categoria pelo seu ID, garantindo que ela pertença ao perfil.
   * @param {number} id - O ID da categoria.
   * @param {number} profileId - O ID do perfil do usuário logado.
   */
  async getById(id, profileId) {
    const category = await Category.findOne({ where: { id, profile_id: profileId } });
    if (!category) throw new Error('Categoria não encontrada ou não pertence a este perfil.');
    return category;
  }

  /**
   * Cria uma nova categoria associada a um perfil.
   * @param {object} data - { name: string, type: 'Mão de Obra' | 'Material' | ..., category_flow: 'expense' | 'revenue' }
   * @param {number} profileId - O ID do perfil do usuário logado.
   */
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

    // Verifica se a categoria já existe PARA ESTE PERFIL E ESTE FLUXO.
    const existingCategory = await Category.findOne({ where: { name, profile_id: profileId, category_flow } });
    if (existingCategory) {
      throw new Error(`A categoria '${name}' (${category_flow === 'expense' ? 'Despesa' : 'Receita'}) já existe neste perfil.`);
    }

    return Category.create({ name, type, category_flow, profile_id: profileId }); // Salva category_flow
  }

  /**
   * Atualiza uma categoria existente, garantindo que ela pertença ao perfil.
   * @param {number} id - O ID da categoria a ser atualizada.
   * @param {object} data - { name: string, type: string, category_flow: 'expense' | 'revenue' }
   * @param {number} profileId - O ID do perfil do usuário logado.
   */
  async update(id, data, profileId) {
    const category = await this.getById(id, profileId);
    
    // Se o nome ou o fluxo estão sendo alterados, verifica unicidade
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

    // Não permite alterar o category_flow se já houver despesas/receitas associadas
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

  /**
   * Deleta uma categoria, garantindo que ela pertença ao perfil.
   * @param {number} id - O ID da categoria.
   * @param {number} profileId - O ID do perfil do usuário logado.
   */
  async delete(id, profileId) {
    const category = await this.getById(id, profileId);
    
    // Verifica se a categoria tem despesas, receitas ou metas vinculadas antes de deletar
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