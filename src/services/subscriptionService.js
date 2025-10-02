// src/services/subscriptionService.js
const { User, Subscription } = require('../models');
const mercadopago = require('../config/mercadoPago'); 
const logger = require('../utils/logger');
const { Op } = require('sequelize');


// ===================================================================
// FUNÇÃO CRÍTICA: CORRIGIR O FORMATO DE DATA PARA O MERCADO PAGO
// ===================================================================
function formatMercadoPagoDate(date) {
    const pad = (n) => String(n).padStart(2, '0');
    const padMs = (n) => String(n).padStart(3, '0');
    
    const year = date.getFullYear();
    const month = pad(date.getMonth() + 1); // getMonth() é 0-base
    const day = pad(date.getDate());
    const hours = pad(date.getHours());
    const minutes = pad(date.getMinutes());
    const seconds = pad(date.getSeconds());
    const ms = padMs(date.getMilliseconds());
    
    // Cálculo do Offset de Fuso Horário
    const offset = -date.getTimezoneOffset(); // Offset em minutos
    const offsetHours = Math.floor(Math.abs(offset) / 60);
    const offsetMinutes = Math.abs(offset) % 60;
    const offsetSign = offset >= 0 ? '+' : '-'; // Se getTimezoneOffset for negativo (países ocidentais), o offset é positivo
    const offsetFormatted = `${offsetSign}${pad(offsetHours)}:${pad(offsetMinutes)}`;
    
    // Formato final: YYYY-MM-DDTHH:MM:SS.MMM+ZZ:ZZ
    return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}.${ms}${offsetFormatted}`;
}
// ===================================================================


const subscriptionService = {
  
  /**
   * Verifica se o usuário tem uma assinatura ativa.
   * @param {number} userId 
   * @returns {Promise<boolean>}
   */
  async isUserActive(userId) {
    // 1. Checagem de Administrador (fabio@gmail.com)
    const user = await User.findByPk(userId);
    if (user?.email === 'fabio@gmail.com') {
      return true;
    }
    
    // 2. Checagem de Assinatura
    const activeSubscription = await Subscription.findOne({
      where: {
        user_id: userId,
        status: 'active',
        expires_at: { [Op.gt]: new Date() } // Não expirado
      }
    });

    return !!activeSubscription;
  },
  
  /**
   * Obtém o status de assinatura para o Front-end.
   * @param {number} userId 
   * @returns {Promise<object>} - { status: 'active' | 'pending' | 'inactive' | 'admin' }
   */
  async getSubscriptionStatus(userId) {
      // 1. Checagem de Administrador (fabio@gmail.com)
      const user = await User.findByPk(userId);
      if (user?.email === 'fabio@gmail.com') {
          return { status: 'active', isAdmin: true, message: 'Conta Administradora.' };
      }
      
      // 2. Checagem de Assinatura (active/pending/inactive)
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

  /**
   * Cria uma preferência de pré-aprovação (Assinatura Recorrente) no Mercado Pago.
   * @param {number} userId - O ID do usuário no nosso sistema.
   */
  async createSubscriptionCheckout(userId) {
    const user = await User.findByPk(userId);
    if (!user) throw new Error("Usuário não encontrado.");
    
    // Valores do plano (Exemplo: $49.90 Mensal)
    const PLAN_VALUE = 49.90;
    
    // Calcula a data de fim (1 ano a partir de agora)
    const endDate = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);

    const preference = {
      // ... (Restante dos dados de preferência de assinatura)
      reason: "Assinatura do Serviço de Monitoramento de Custos",
      external_reference: userId.toString(),
      auto_recurring: {
        frequency: 1, // Mensal
        frequency_type: "months",
        transaction_amount: PLAN_VALUE, // Valor
        currency_id: "BRL",
        // CRÍTICO: USAR O NOVO FORMATADOR
        start_date: formatMercadoPagoDate(new Date()), 
        end_date: formatMercadoPagoDate(endDate), // CRÍTICO: USAR O NOVO FORMATADOR
      },
      payer_email: user.email,
      back_url: `${process.env.FRONTEND_URL}/settings?subscription=success`,
      notification_url: `${process.env.BASE_URL}/api/payments/webhook`,
      binary_mode: true, // Garante que apenas pagamentos aprovados passem
    };

    const response = await mercadopago.preapproval.create(preference);

    // Cria/Atualiza o registro no nosso banco de dados
    const [subscription] = await Subscription.findOrCreate({
      where: { user_id: userId },
      defaults: { status: 'pending', preapproval_id: response.body.id, user_id: userId }
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

  /**
   * NOVO: Processa a renovação bem-sucedida de um ciclo de assinatura (Webhook de Payment).
   * @param {number} userId - ID do usuário no nosso sistema (do external_reference).
   * @param {object} paymentData - Dados do pagamento do MP.
   */
  async processSubscriptionRenewal(userId, paymentData) {
      // 1. Busca a assinatura do usuário (deve haver apenas uma)
      const subscription = await Subscription.findOne({ where: { user_id: userId } });
      if (!subscription) {
          logger.warn(`Renovação: Assinatura não encontrada para o User ${userId}.`);
          return;
      }
      
      // 2. Calcula a nova data de expiração (adiciona 1 mês à expiração ATUAL ou à data de hoje)
      const now = new Date();
      // Se a data de expiração não for válida ou já passou, usamos 'now' como base
      let baseDate = subscription.expires_at && subscription.expires_at > now ? subscription.expires_at : now;
      
      // Adiciona 1 mês à data base
      const nextMonth = new Date(baseDate.setMonth(baseDate.getMonth() + 1));

      // 3. Atualiza o status e a expiração
      await subscription.update({
          status: 'active',
          expires_at: nextMonth,
      });

      logger.info(`Renovação: Assinatura do User ${userId} renovada com sucesso. Nova expiração: ${nextMonth.toISOString()}`);
  },

  /**
   * Processa o Webhook de Pré-Aprovação do Mercado Pago (Criação/Cancelamento).
   * @param {object} data - Dados do webhook.
   */
  async processPreapprovalWebhook(data) {
      const { id, external_reference, status, reason, date_created, next_payment_date } = data;
      const userId = external_reference;
      
      // Mapeamento de status do Mercado Pago para nosso sistema
      let newStatus = 'pending';
      if (status === 'authorized' || status === 'pending' || status === 'in_process') newStatus = 'pending';
      if (status === 'approved') newStatus = 'active';
      if (status === 'cancelled' || status === 'suspended' || status === 'paused') newStatus = 'cancelled';
      
      // Busca a assinatura (usa o preapproval_id que é único)
      const subscription = await Subscription.findOne({ where: { preapproval_id: id } });

      if (!subscription) {
        logger.warn(`Webhook: Assinatura com preapproval_id ${id} não encontrada.`);
        return;
      }
      
      // Calcula o próximo vencimento para a expiração
      let expirationDate = subscription.expires_at;
      if (newStatus === 'active') {
          // Se for a primeira aprovação, usa a data do próximo pagamento do MP (next_payment_date)
          // ou calcula a partir de hoje (+30 dias)
          expirationDate = next_payment_date ? new Date(next_payment_date) : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      }
      
      await subscription.update({
        status: newStatus,
        expires_at: expirationDate, 
      });
      
      logger.info(`Webhook: Assinatura do User ${userId} (${id}) atualizada para status: ${newStatus}`);
  },
};

module.exports = subscriptionService;