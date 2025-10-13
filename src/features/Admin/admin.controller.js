// src/features/Admin/admin.controller.js
const { User, Subscription, Profile } = require('../../models');
const mercadopago = require('../../config/mercadoPago');
const logger = require('../../utils/logger');
const subscriptionService = require('../../services/subscriptionService');

class AdminController {
  
  // GET /admin/users
  async getAllUsers(req, res) {
    try {
      const users = await User.findAll({
        attributes: ['id', 'email', 'whatsapp_phone', 'status', 'createdAt', 'updatedAt'],
        // Inclui a assinatura com o novo campo de limite
        include: [{ model: Subscription, as: 'subscription', attributes: ['status', 'expires_at', 'profile_limit'] }],
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
      const response = await mercadopago.payment.search({
        qs: {
          status: 'approved',
          sort: 'date_created',
          criteria: 'desc',
          limit: 100,
        }
      });
      
      const payments = response.body.results || [];
      res.status(200).json(payments);
    } catch (error) {
      logger.error('[AdminController] Erro ao buscar pagamentos do Mercado Pago:', error);
      res.status(500).json({ error: 'Erro ao buscar dados de lucros.' });
    }
  }

  // POST /admin/users
  async createUser(req, res) {
    const { email, password, whatsapp_phone } = req.body;
    if (!email || !password || !whatsapp_phone) {
      return res.status(400).json({ error: 'Email, senha e WhatsApp são obrigatórios.' });
    }
    try {
      const existingUser = await User.findOne({ where: { email } });
      if (existingUser) {
          return res.status(409).json({ error: 'Este email já está em uso.' });
      }

      const newUser = await User.create({ email, password, whatsapp_phone, status: 'pending' });
      // Cria o perfil principal para o novo usuário
      await Profile.create({ name: 'Perfil Principal', user_id: newUser.id });
      logger.info(`[Admin] Usuário ${email} criado pelo administrador.`);
      res.status(201).json(newUser);
    } catch (error) {
      logger.error('[AdminController] Erro ao criar usuário:', error);
      res.status(500).json({ error: 'Erro interno ao criar usuário.' });
    }
  }

  // PUT /admin/users/:id
  async updateUser(req, res) {
    const { id } = req.params;
    const { email, password, whatsapp_phone } = req.body;
    try {
      const user = await User.findByPk(id);
      if (!user) return res.status(404).json({ error: 'Usuário não encontrado.' });
      
      if (email) user.email = email;
      if (password) user.password = password; 
      if (whatsapp_phone) user.whatsapp_phone = whatsapp_phone;

      await user.save();
      logger.info(`[Admin] Usuário ${user.email} (ID: ${id}) atualizado pelo administrador.`);
      res.status(200).json(user);
    } catch (error) {
      logger.error(`[AdminController] Erro ao atualizar usuário ${id}:`, error);
      res.status(500).json({ error: 'Erro ao atualizar usuário.' });
    }
  }

  // DELETE /admin/users/:id
  async deleteUser(req, res) {
    const { id } = req.params;
    try {
      const user = await User.findByPk(id);
      if (!user) return res.status(404).json({ error: 'Usuário não encontrado.' });
      if (user.email === 'fabio@gmail.com') {
        return res.status(403).json({ error: 'Não é possível deletar o administrador principal.' });
      }

      await user.destroy();
      logger.info(`[Admin] Usuário ${user.email} (ID: ${id}) deletado pelo administrador.`);
      res.status(200).json({ message: 'Usuário deletado com sucesso.' });
    } catch (error) {
      logger.error(`[AdminController] Erro ao deletar usuário ${id}:`, error);
      res.status(500).json({ error: 'Erro ao deletar usuário.' });
    }
  }
  
  /**
   * <<< MÉTODO ATUALIZADO >>>
   * PUT /admin/users/:id/subscription
   * Atualiza o status e/ou o limite de perfis da assinatura de um usuário.
   */
  async updateUserSubscription(req, res) {
    const { id } = req.params;
    const { status, profileLimit } = req.body;

    if (!status || !['active', 'cancelled'].includes(status)) {
        return res.status(400).json({ error: "O status deve ser 'active' ou 'cancelled'." });
    }
    // O profileLimit é opcional, mas se vier, deve ser um número
    if (profileLimit !== undefined && (isNaN(parseInt(profileLimit, 10)) || parseInt(profileLimit, 10) < 1)) {
        return res.status(400).json({ error: "O limite de perfis deve ser um número maior ou igual a 1." });
    }

    try {
        const updatedSubscription = await subscriptionService.adminUpdateUserSubscription(id, { status, profileLimit });
        res.status(200).json({ message: 'Assinatura atualizada com sucesso.', subscription: updatedSubscription });
    } catch (error) {
        logger.error(`[AdminController] Erro ao atualizar assinatura para usuário ${id}:`, error);
        res.status(500).json({ error: error.message });
    }
  }
}

module.exports = new AdminController();