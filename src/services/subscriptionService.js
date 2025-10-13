// src/services/subscriptionService.js
const { User, Subscription, Profile } = require('../models'); // <<< Adicionado Profile
const mercadopago = require('../config/mercadoPago'); 
const logger = require('../utils/logger');
const { Op } = require('sequelize');
const whatsappService = require('../utils/whatsappService');


function formatMercadoPagoDate(date) {
    const pad = (n) => String(n).padStart(2, '0');
    const padMs = (n) => String(n).padStart(3, '0');
    
    const year = date.getFullYear();
    const month = pad(date.getMonth() + 1);
    const day = pad(date.getDate());
    const hours = pad(date.getHours());
    const minutes = pad(date.getMinutes());
    const seconds = pad(date.getSeconds());
    const ms = padMs(date.getMilliseconds());
    
    const offset = -date.getTimezoneOffset();
    const offsetHours = Math.floor(Math.abs(offset) / 60);
    const offsetMinutes = Math.abs(offset) % 60;
    const offsetFormatted = `-${pad(offsetHours)}:${pad(offsetMinutes)}`;
    
    return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}.${ms}${offsetFormatted}`;
}

const subscriptionService = {
  
  /**
   * Verifica se o usuário tem uma assinatura ativa.
   */
  async isUserActive(userId) {
    const user = await User.findByPk(userId);
    if (user?.email === 'fabio@gmail.com') {
      return true;
    }
    
    const activeSubscription = await Subscription.findOne({
      where: {
        user_id: userId,
        status: 'active',
        expires_at: { [Op.gt]: new Date() }
      }
    });

    return !!activeSubscription;
  },

  /**
   * <<< NOVA FUNÇÃO INTERNA >>>
   * Verifica se um usuário pode criar um novo perfil com base no seu limite.
   * Lança um erro se o limite for atingido.
   * @param {number} userId - ID do usuário.
   */
  async _checkProfileLimit(userId) {
      const user = await User.findByPk(userId, {
          include: [{ model: Subscription, as: 'subscription' }]
      });

      // Admin principal tem limite infinito
      if (user?.email === 'fabio@gmail.com') {
          return;
      }

      const subscription = user?.subscription;
      if (!subscription) {
          throw new Error('Nenhuma assinatura encontrada para este usuário.');
      }

      const currentProfileCount = await Profile.count({ where: { user_id: userId } });
      
      if (currentProfileCount >= subscription.profile_limit) {
          throw new Error(`Limite de ${subscription.profile_limit} perfis atingido. Para criar mais perfis, contate o suporte.`);
      }
  },
  
  async getSubscriptionStatus(userId) {
      const user = await User.findByPk(userId);
      if (user?.email === 'fabio@gmail.com') {
          return { status: 'active', isAdmin: true, message: 'Conta Administradora.' };
      }
      
      const subscription = await Subscription.findOne({
          where: { user_id: userId },
          order: [['expires_at', 'DESC']]
      });

      if (!subscription) {
          return { status: 'inactive', message: 'Nenhuma assinatura encontrada.' };
      }
      
      const isExpired = subscription.expires_at && subscription.expires_at < new Date();
      
      if (subscription.status === 'active' && !isExpired) {
          return { status: 'active', message: `Plano ativo. Expira em: ${subscription.expires_at.toLocaleDateString()}` };
      }
      
      if (subscription.status === 'pending' && !isExpired) {
          return { status: 'pending', message: 'Pagamento pendente de confirmação.' };
      }
      
      return { status: 'inactive', message: 'Assinatura cancelada ou expirada.' };
  },

  async createSubscriptionCheckout(userId) {
    const user = await User.findByPk(userId);
    if (!user) throw new Error("Usuário não encontrado.");
    
    const PLAN_VALUE = 49.90;
    const endDate = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);

    const preference = {
      reason: "Assinatura do Serviço de Monitoramento de Custos",
      external_reference: userId.toString(),
      auto_recurring: {
        frequency: 1,
        frequency_type: "months",
        transaction_amount: PLAN_VALUE,
        currency_id: "BRL",
        start_date: formatMercadoPagoDate(new Date()), 
        end_date: formatMercadoPagoDate(endDate),
      },
      payer_email: user.email,
      back_url: `${process.env.FRONTEND_URL}/settings?subscription=success`,
      notification_url: `${process.env.BASE_URL}/api/payments/webhook`,
      binary_mode: true,
    };

    const response = await mercadopago.preapproval.create(preference);

    const [subscription] = await Subscription.findOrCreate({
      where: { user_id: userId },
      defaults: { status: 'pending', preapproval_id: response.body.id, user_id: userId, profile_limit: 1 }
    });
    
    await subscription.update({
        preapproval_id: response.body.id,
        status: 'pending',
    });

    return {
      checkoutUrl: response.body.init_point,
      preapprovalId: response.body.id,
    };
  },

  async processSubscriptionRenewal(userId, paymentData) {
      const subscription = await Subscription.findOne({ where: { user_id: userId } });
      if (!subscription) {
          logger.warn(`Renovação: Assinatura não encontrada para o User ${userId}.`);
          return;
      }
      
      const now = new Date();
      let baseDate = subscription.expires_at && subscription.expires_at > now ? subscription.expires_at : now;
      
      const nextMonth = new Date(baseDate.setMonth(baseDate.getMonth() + 1));

      await subscription.update({
          status: 'active',
          expires_at: nextMonth,
      });

      logger.info(`Renovação: Assinatura do User ${userId} renovada com sucesso. Nova expiração: ${nextMonth.toISOString()}`);
  },

  /**
   * <<< FUNÇÃO ATUALIZADA >>>
   * Permite que um admin ative, desative ou atualize o limite de perfis de um usuário.
   * @param {number} userId - ID do usuário a ser modificado.
   * @param {object} data - Contém { status: 'active' | 'cancelled', profileLimit: number }
   * @returns {Promise<Subscription>} A assinatura atualizada.
   */
  async adminUpdateUserSubscription(userId, data) {
    const { status: newStatus, profileLimit } = data;

    const user = await User.findByPk(userId);
    if (!user) {
        throw new Error("Usuário não encontrado.");
    }
    if (user.email === 'fabio@gmail.com') {
        throw new Error("Não é possível alterar a assinatura do administrador principal.");
    }
    
    const [subscription] = await Subscription.findOrCreate({
        where: { user_id: userId },
        defaults: { user_id: userId, status: 'pending', profile_limit: 1 }
    });
    
    // Prepara o objeto de atualização
    const updateData = {
        status: newStatus,
        profile_limit: profileLimit !== undefined ? parseInt(profileLimit, 10) : subscription.profile_limit,
    };

    if (newStatus === 'active') {
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + 30);
        updateData.expires_at = expiresAt;

        await subscription.update(updateData);
        
        if (user.status === 'pending') {
            user.status = 'active';
            await user.save();
        }

        if (user.whatsapp_phone) {
            const onboardingMessage = `Olá! 👋 Seu plano na plataforma foi ativado por um administrador.\n\nPara começar a monitorar os custos, siga os passos:\n\n1️⃣ Crie um grupo no WhatsApp para seu projeto.\n2️⃣ Me adicione ao grupo.\n\nEu irei te guiar na configuração do seu perfil diretamente por lá!`;
            await whatsappService.sendWhatsappMessage(user.whatsapp_phone, onboardingMessage);
            logger.info(`[Admin] Onboarding por ativação manual enviado para ${user.email}`);
        } else {
            logger.warn(`[Admin] Usuário ${user.email} ativado, mas sem número de WhatsApp para notificação.`);
        }

    } else { // newStatus === 'cancelled'
        updateData.expires_at = new Date(); // Expira imediatamente
        await subscription.update(updateData);
        logger.info(`[Admin] Assinatura do usuário ${user.email} foi desativada/atualizada.`);
    }
    
    return subscription.reload();
  },

  async processPreapprovalWebhook(data) {
      const { id, external_reference, status } = data;
      const userId = external_reference;
      
      let newStatus = 'pending';
      if (status === 'authorized' || status === 'pending' || status === 'in_process') newStatus = 'pending';
      if (status === 'approved') newStatus = 'active';
      if (status === 'cancelled' || status === 'suspended' || status === 'paused') newStatus = 'cancelled';
      
      const subscription = await Subscription.findOne({ where: { preapproval_id: id } });

      if (!subscription) {
        logger.warn(`Webhook: Assinatura com preapproval_id ${id} não encontrada.`);
        return;
      }
      
      let expirationDate = subscription.expires_at;
      if (newStatus === 'active') {
          expirationDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      }
      
      await subscription.update({
        status: newStatus,
        expires_at: expirationDate, 
        // Ao ser ativado via MP, o plano padrão tem limite 1
        profile_limit: newStatus === 'active' ? 1 : subscription.profile_limit,
      });
      
      logger.info(`Webhook: Assinatura do User ${userId} (${id}) atualizada para status: ${newStatus}`);
  },
};

// Exporta o objeto inteiro, incluindo a nova função interna
module.exports = subscriptionService;