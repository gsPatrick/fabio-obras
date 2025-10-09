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

  // <<< NOVO: POST /admin/users >>>
  async createUser(req, res) {
    const { email, password, whatsapp_phone } = req.body;
    if (!email || !password || !whatsapp_phone) {
      return res.status(400).json({ error: 'Email, senha e WhatsApp são obrigatórios.' });
    }
    try {
      const newUser = await User.create({ email, password, whatsapp_phone, status: 'pending' });
      // Admin cria o usuário, mas o primeiro perfil pode ser criado depois ou pelo próprio usuário.
      // Vamos criar um perfil padrão para consistência.
      await Profile.create({ name: 'Perfil Principal', user_id: newUser.id });
      logger.info(`[Admin] Usuário ${email} criado pelo administrador.`);
      res.status(201).json(newUser);
    } catch (error) {
      logger.error('[AdminController] Erro ao criar usuário:', error);
      res.status(500).json({ error: 'Erro ao criar usuário.' });
    }
  }

  // <<< NOVO: PUT /admin/users/:id >>>
  async updateUser(req, res) {
    const { id } = req.params;
    const { email, password, whatsapp_phone } = req.body;
    try {
      const user = await User.findByPk(id);
      if (!user) return res.status(404).json({ error: 'Usuário não encontrado.' });
      
      if (email) user.email = email;
      // Se uma nova senha for fornecida, ela será hasheada pelo hook do model
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

  // <<< NOVO: DELETE /admin/users/:id >>>
  async deleteUser(req, res) {
    const { id } = req.params;
    try {
      const user = await User.findByPk(id);
      if (!user) return res.status(404).json({ error: 'Usuário não encontrado.' });
      if (user.email === 'fabio@gmail.com') {
        return res.status(403).json({ error: 'Não é possível deletar o administrador principal.' });
      }

      await user.destroy(); // Isso deve deletar em cascata os perfis, assinaturas, etc. (se configurado no DB)
      logger.info(`[Admin] Usuário ${user.email} (ID: ${id}) deletado pelo administrador.`);
      res.status(200).json({ message: 'Usuário deletado com sucesso.' });
    } catch (error) {
      logger.error(`[AdminController] Erro ao deletar usuário ${id}:`, error);
      res.status(500).json({ error: 'Erro ao deletar usuário.' });
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