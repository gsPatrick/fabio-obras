// src/features/Payment/payment.controller.js
const subscriptionService = require('../../services/subscriptionService');
const logger = require('../../utils/logger');
const mercadopago = require('../../config/mercadoPago'); // Para buscar detalhes

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
      const mpTopic = topic || action || type; // Tenta obter o tipo do evento

      if (mpTopic === 'preapproval') {
          // Webhook para criação/alteração/suspensão da PRÉ-APROVAÇÃO (Assinatura)
          const preapprovalId = data?.id || req.query['data.id'];

          if (preapprovalId) {
              const preapproval = await mercadopago.preapproval.get(preapprovalId);
              await subscriptionService.processPreapprovalWebhook(preapproval.body);
          }

      } else if (mpTopic === 'payment') {
          // Webhook para cobranças (PAGAMENTOS) - Usado para renovação automática
          const paymentId = data?.id || req.query['data.id'];
          
          if (paymentId) {
              const payment = await mercadopago.payment.findById(paymentId);
              const paymentData = payment.body;
              
              // CRÍTICO: Se houver um external_reference, o MP o associa ao user/assinatura
              const externalReferenceUserId = paymentData.external_reference; 

              if (externalReferenceUserId) {
                  // O pagamento de renovação foi APROVADO.
                  if (paymentData.status === 'approved') {
                      await subscriptionService.processSubscriptionRenewal(externalReferenceUserId, paymentData);
                  }
                  // Pagamentos rejeitados/pendentes de renovação também podem ser tratados, 
                  // mas o MP envia um preapproval webhook se o status da assinatura mudar.
              } else {
                  logger.warn('[PaymentController] Webhook de pagamento ignorado: Sem external_reference (não é de assinatura).');
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