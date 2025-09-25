const { Category } = require('../../models');

class CategoryService {
  /**
   * Lista todas as categorias existentes.
   */
  async getAll() {
    return Category.findAll({ order: [['type', 'ASC'], ['name', 'ASC']] });
  }

  /**
   * Busca uma única categoria pelo seu ID.
   */
  async getById(id) {
    const category = await Category.findByPk(id);
    if (!category) throw new Error('Categoria não encontrada');
    return category;
  }

  /**
   * Cria uma nova categoria.
   * @param {object} data - { name: string, type: 'Mão de Obra' | 'Material' | ... }
   */
  async create(data) {
    const { name, type } = data;
    if (!name || !type) {
      throw new Error('Nome e tipo são obrigatórios.');
    }
    // Verifica se já existe para evitar duplicatas
    const existingCategory = await Category.findOne({ where: { name } });
    if (existingCategory) {
      throw new Error(`A categoria '${name}' já existe.`);
    }
    return Category.create({ name, type });
  }

  /**
   * Atualiza uma categoria existente.
   * @param {number} id - O ID da categoria a ser atualizada.
   * @param {object} data - { name: string, type: string }
   */
  async update(id, data) {
    const category = await this.getById(id);
    
    // Se o nome está sendo alterado, verifica se o novo nome já não está em uso por outra categoria
    if (data.name && data.name !== category.name) {
      const existingCategory = await Category.findOne({ where: { name: data.name } });
      if (existingCategory) {
        throw new Error(`O nome de categoria '${data.name}' já está em uso.`);
      }
    }

    await category.update(data);
    return category;
  }

  /**
   * Deleta uma categoria.
   * ATENÇÃO: Despesas associadas a esta categoria perderão a referência.
   * Uma abordagem mais segura seria desativar a categoria em vez de deletar.
   */
  async delete(id) {
    const category = await this.getById(id);
    await category.destroy();
    return { message: 'Categoria deletada com sucesso.' };
  }
}

module.exports = new CategoryService();