// src/features/CategoryManager/category.service.js

const { Category } = require('../../models');

class CategoryService {
  /**
   * Lista todas as categorias pertencentes a um perfil específico.
   * @param {number} profileId - O ID do perfil do usuário logado.
   */
  async getAll(profileId) {
    // VALIDAÇÃO: Garante que o profileId foi fornecido.
    if (!profileId) {
      throw new Error('ID do Perfil é obrigatório.');
    }
    // CORREÇÃO: Adicionado 'where' para filtrar por profile_id.
    return Category.findAll({ 
      where: { profile_id: profileId },
      order: [['type', 'ASC'], ['name', 'ASC']] 
    });
  }

  /**
   * Busca uma única categoria pelo seu ID, garantindo que ela pertença ao perfil.
   * @param {number} id - O ID da categoria.
   * @param {number} profileId - O ID do perfil do usuário logado.
   */
  async getById(id, profileId) {
    // CORREÇÃO: Busca usando 'id' e 'profile_id' para segurança.
    const category = await Category.findOne({ where: { id, profile_id: profileId } });
    if (!category) throw new Error('Categoria não encontrada ou não pertence a este perfil.');
    return category;
  }

  /**
   * Cria uma nova categoria associada a um perfil.
   * @param {object} data - { name: string, type: 'Mão de Obra' | 'Material' | ... }
   * @param {number} profileId - O ID do perfil do usuário logado.
   */
  async create(data, profileId) { // <<< CORREÇÃO: Adicionado 'profileId' como parâmetro.
    const { name, type } = data;

    // VALIDAÇÃO: Garante que o profileId foi fornecido.
    if (!profileId) {
        throw new Error('ID do Perfil é obrigatório para criar uma categoria.');
    }
    if (!name || !type) {
      throw new Error('Nome e tipo são obrigatórios.');
    }

    // CORREÇÃO: Verifica se a categoria já existe PARA ESTE PERFIL.
    const existingCategory = await Category.findOne({ where: { name, profile_id: profileId } });
    if (existingCategory) {
      throw new Error(`A categoria '${name}' já existe neste perfil.`);
    }

    // CORREÇÃO: Adicionado 'profile_id' ao objeto de criação.
    return Category.create({ name, type, profile_id: profileId });
  }

  /**
   * Atualiza uma categoria existente, garantindo que ela pertença ao perfil.
   * @param {number} id - O ID da categoria a ser atualizada.
   * @param {object} data - { name: string, type: string }
   * @param {number} profileId - O ID do perfil do usuário logado.
   */
  async update(id, data, profileId) { // <<< CORREÇÃO: Adicionado 'profileId' como parâmetro.
    // CORREÇÃO: getById agora também valida a posse do perfil.
    const category = await this.getById(id, profileId);
    
    if (data.name && data.name !== category.name) {
      // CORREÇÃO: Verifica se o novo nome já está em uso POR ESTE PERFIL.
      const existingCategory = await Category.findOne({ where: { name: data.name, profile_id: profileId } });
      if (existingCategory) {
        throw new Error(`O nome de categoria '${data.name}' já está em uso neste perfil.`);
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
  async delete(id, profileId) { // <<< CORREÇÃO: Adicionado 'profileId' como parâmetro.
    // CORREÇÃO: getById agora valida a posse do perfil antes de deletar.
    const category = await this.getById(id, profileId);
    await category.destroy();
    return { message: 'Categoria deletada com sucesso.' };
  }
}

module.exports = new CategoryService();