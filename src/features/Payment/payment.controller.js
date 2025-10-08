// src/features/Payment/payment.controller.js
const subscriptionService = require('../../services/subscriptionService');
const logger = require('../../utils/logger');
const mercadopago = require('../../config/mercadoPago');
const { User, Profile } = require('../../models'); // <<< IMPORTAR USER E PROFILE

class PaymentController {
  
  async createSubscriptionCheckout(req, res) {
    const userId = req.userId; 
    try {
      const checkout = await subscriptionService.createSubscriptionCheckout(userId);
      res.status(200).json(checkout);
    } catch (error) {
      logger.error('[PaymentController] Erro ao criar checkout de assinatura:', error);
      res.status(500).json({ error: 'Falha ao criar o checkout de assinatura.' });
    }
  }

  async webhook(req, res) {
    try {
      const { topic, action, type, data } = req.body; 
      const mpTopic = topic || action || type;

      if (mpTopic === 'preapproval') {
          const preapprovalId = data?.id || req.query['data.id'];
          if (preapprovalId) {
              const preapproval = await mercadopago.preapproval.get(preapprovalId);
              const preapprovalBody = preapproval.body;
              
              // <<< LÓGICA DE ATIVAÇÃO DE USUÁRIO >>>
              // Se a assinatura foi aprovada pela primeira vez
              if (preapprovalBody.status === 'authorized' || preapprovalBody.status === 'approved') {
                  const userId = preapprovalBody.external_reference;
                  const user = await User.findByPk(userId);

                  // Se o usuário estava pendente, ativa e cria o perfil
                  if (user && user.status === 'pending') {
                      user.status = 'active';
                      // Define uma senha temporária forte que o usuário poderá alterar depois
                      user.password = require('crypto').randomBytes(16).toString('hex');
                      await user.save();

                      // Cria o primeiro perfil padrão para o usuário
                      await Profile.findOrCreate({
                          where: { user_id: user.id },
                          defaults: { name: 'Perfil Principal' }
                      });
                      logger.info(`[PaymentWebhook] Usuário ${user.email} (ID: ${userId}) ativado e perfil criado após pagamento.`);
                  }
              }
              // <<< FIM DA LÓGICA DE ATIVAÇÃO >>>

              await subscriptionService.processPreapprovalWebhook(preapprovalBody);
          }

      } else if (mpTopic === 'payment') {
          const paymentId = data?.id || req.query['data.id'];
          if (paymentId) {
              const payment = await mercadopago.payment.findById(paymentId);
              const paymentData = payment.body;
              const externalReferenceUserId = paymentData.external_reference; 

              if (externalReferenceUserId && paymentData.status === 'approved') {
                  await subscriptionService.processSubscriptionRenewal(externalReferenceUserId, paymentData);
              }
          }
      }
      
      res.status(200).json({ message: "Webhook processado" });
    } catch (error) {
      logger.error('[PaymentController] Erro ao processar webhook de pagamento:', error);
      res.status(200).json({ message: "Webhook recebido" }); 
    }
  }
}

module.exports = new PaymentController();