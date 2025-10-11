// src/features/CreditCardManager/creditCard.controller.js
const creditCardService = require('./creditCard.service');
const logger = require('../../utils/logger');

class CreditCardController {

  // POST /credit-cards
  async create(req, res) {
    try {
      const card = await creditCardService.createCreditCard(req.profileId, req.body);
      res.status(201).json(card);
    } catch (error) {
      logger.error('[CreditCardController] Erro ao criar cartão de crédito:', error);
      res.status(400).json({ error: error.message });
    }
  }

  // GET /credit-cards
  async findAll(req, res) {
    try {
      const cards = await creditCardService.getAllCreditCards(req.profileId);
      res.status(200).json(cards);
    } catch (error) {
      logger.error('[CreditCardController] Erro ao listar cartões de crédito:', error);
      res.status(500).json({ error: 'Erro interno ao listar cartões de crédito.' });
    }
  }

  // GET /credit-cards/:id
  async findById(req, res) {
    try {
      const card = await creditCardService.getCreditCardById(req.params.id, req.profileId);
      res.status(200).json(card);
    } catch (error) {
      logger.error(`[CreditCardController] Erro ao buscar cartão de crédito ${req.params.id}:`, error);
      res.status(404).json({ error: error.message });
    }
  }

  // PUT /credit-cards/:id
  async update(req, res) {
    try {
      const card = await creditCardService.updateCreditCard(req.params.id, req.profileId, req.body);
      res.status(200).json(card);
    } catch (error) {
      logger.error(`[CreditCardController] Erro ao atualizar cartão de crédito ${req.params.id}:`, error);
      res.status(400).json({ error: error.message });
    }
  }

  // DELETE /credit-cards/:id
  async delete(req, res) {
    try {
      const result = await creditCardService.deleteCreditCard(req.params.id, req.profileId);
      res.status(200).json(result);
    } catch (error) {
      logger.error(`[CreditCardController] Erro ao deletar cartão de crédito ${req.params.id}:`, error);
      res.status(404).json({ error: error.message });
    }
  }
}

module.exports = new CreditCardController();