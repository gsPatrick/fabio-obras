// src/features/CreditCardManager/creditCard.service.js
const { CreditCard, Profile } = require('../../models');
const { Op } = require('sequelize');
const logger = require('../../utils/logger');

class CreditCardService {

  /**
   * Cria um novo cartão de crédito para um perfil.
   * @param {number} profileId - ID do perfil.
   * @param {object} cardData - Dados do cartão (name, last_four_digits, closing_day, due_day).
   */
  async createCreditCard(profileId, cardData) {
    if (!profileId) {
      throw new Error('ID do Perfil é obrigatório para criar um cartão de crédito.');
    }
    const { name, last_four_digits, closing_day, due_day } = cardData;

    if (!name || !closing_day || !due_day) {
      throw new Error('Nome, dia de fechamento e dia de vencimento são obrigatórios.');
    }
    if (closing_day < 1 || closing_day > 31 || due_day < 1 || due_day > 31) {
      throw new Error('Os dias de fechamento e vencimento devem ser entre 1 e 31.');
    }

    // Verifica se já existe um cartão com o mesmo nome para este perfil
    const existingCard = await CreditCard.findOne({ where: { name, profile_id: profileId } });
    if (existingCard) {
      throw new Error(`Já existe um cartão com o nome '${name}' neste perfil.`);
    }

    return CreditCard.create({
      profile_id: profileId,
      name,
      last_four_digits: last_four_digits || null,
      closing_day,
      due_day,
      is_active: true, // Por padrão, o cartão é criado como ativo
    });
  }

  /**
   * Lista todos os cartões de crédito de um perfil.
   * @param {number} profileId - ID do perfil.
   */
  async getAllCreditCards(profileId) {
    if (!profileId) {
      throw new Error('ID do Perfil é obrigatório para listar cartões de crédito.');
    }
    return CreditCard.findAll({
      where: { profile_id: profileId },
      order: [['name', 'ASC']],
    });
  }

  /**
   * Busca um cartão de crédito pelo ID, garantindo que pertença ao perfil.
   * @param {number} cardId - ID do cartão.
   * @param {number} profileId - ID do perfil.
   */
  async getCreditCardById(cardId, profileId) {
    const card = await CreditCard.findOne({ where: { id: cardId, profile_id: profileId } });
    if (!card) {
      throw new Error('Cartão de crédito não encontrado ou não pertence a este perfil.');
    }
    return card;
  }

  /**
   * Atualiza um cartão de crédito existente.
   * @param {number} cardId - ID do cartão a ser atualizado.
   * @param {number} profileId - ID do perfil.
   * @param {object} updateData - Dados para atualização.
   */
  async updateCreditCard(cardId, profileId, updateData) {
    const card = await this.getCreditCardById(cardId, profileId);

    // Se o nome está sendo alterado, verifica unicidade
    if (updateData.name && updateData.name !== card.name) {
      const existingCard = await CreditCard.findOne({ where: { name: updateData.name, profile_id: profileId } });
      if (existingCard && existingCard.id !== cardId) {
        throw new Error(`Já existe um cartão com o nome '${updateData.name}' neste perfil.`);
      }
    }

    // Valida dias de fechamento/vencimento
    if (updateData.closing_day && (updateData.closing_day < 1 || updateData.closing_day > 31)) {
        throw new Error('O dia de fechamento deve ser entre 1 e 31.');
    }
    if (updateData.due_day && (updateData.due_day < 1 || updateData.due_day > 31)) {
        throw new Error('O dia de vencimento deve ser entre 1 e 31.');
    }

    await card.update(updateData);
    return card;
  }

  /**
   * Deleta um cartão de crédito.
   * @param {number} cardId - ID do cartão a ser deletado.
   * @param {number} profileId - ID do perfil.
   */
  async deleteCreditCard(cardId, profileId) {
    const card = await this.getCreditCardById(cardId, profileId);
    
    // TODO: Adicionar lógica para verificar se existem despesas vinculadas
    // e o que fazer com elas (desvincular, impedir exclusão, etc.).
    // Por enquanto, a FK pode gerar um erro se houver despesas vinculadas.

    await card.destroy();
    return { message: 'Cartão de crédito deletado com sucesso.' };
  }
}

module.exports = new CreditCardService();