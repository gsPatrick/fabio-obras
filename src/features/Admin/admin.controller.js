// src/features/Admin/admin.controller.js
const { User, Subscription } = require('../../models');
const mercadopago = require('../../config/mercadoPago');
const logger = require('../../utils/logger');
const subscriptionService = require('../../services/subscriptionService'); // <<< IMPORTAR O SERVIÇO

class AdminController {
  
  // GET /admin/users
  async getAllUsers(req, res) {
    try {
      const users = await User.findAll({
        attributes: ['id', 'email', 'whatsapp_phone', 'status', 'createdAt', 'updatedAt'],
        include: [{ model: Subscription, as: 'subscription', attributes: ['status', 'expires_at'] }],
        order: [['createdAt', 'DESC']],
      });
      res.status(200).json(users);
    } catch (error) {
      logger.error('[AdminController] Erro ao buscar usuários:', error);
      res.status(500).json({ error: 'Erro interno ao buscar usuários.' });
    }
  }

  // GET /admin/profits
  async getProfits(req, res) {
    try {
      // Busca por todos os pagamentos com status 'approved'
      const response = await mercadopago.payment.search({
        qs: {
          status: 'approved',
          sort: 'date_created',
          criteria: 'desc',
          limit: 100, // Limite de 100 por página, pode ser paginado no futuro
        }
      });
      
      const payments = response.body.results || [];
      res.status(200).json(payments);
    } catch (error) {
      logger.error('[AdminController] Erro ao buscar pagamentos do Mercado Pago:', error);
      res.status(500).json({ error: 'Erro ao buscar dados de lucros.' });
    }
  }

  // <<< NOVO MÉTODO >>>
  // PUT /admin/users/:id/subscription/status
  async updateUserSubscriptionStatus(req, res) {
    const { id } = req.params;
    const { status } = req.body;

    if (!status || !['active', 'cancelled'].includes(status)) {
        return res.status(400).json({ error: "O status deve ser 'active' ou 'cancelled'." });
    }

    try {
        const updatedSubscription = await subscriptionService.adminUpdateUserSubscription(id, status);
        res.status(200).json({ message: 'Status da assinatura atualizado com sucesso.', subscription: updatedSubscription });
    } catch (error) {
        logger.error(`[AdminController] Erro ao atualizar assinatura para usuário ${id}:`, error);
        res.status(500).json({ error: error.message });
    }
  }
}

module.exports = new AdminController();