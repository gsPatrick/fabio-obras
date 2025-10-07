// src/features/WhatsappWebhook/whatsappWebhook.controller.js

const webhookService = require('./whatsappWebhook.service');
const logger = require('../../utils/logger');

class WebhookController {
  /**
   * Lida com a requisição POST do webhook da Z-API.
   */
  async handleWebhook(req, res) {
    // <<< MUDANÇA PARA DEPURAÇÃO >>>
    // Loga o corpo inteiro da requisição para análise
    console.log('==================== INÍCIO DO PAYLOAD DO WEBHOOK ====================');
    console.log(JSON.stringify(req.body, null, 2)); // Usamos JSON.stringify para formatar e ver o objeto completo
    console.log('==================== FIM DO PAYLOAD DO WEBHOOK ====================');
    // <<< FIM DA MUDANÇA >>>
    
    logger.info('[WebhookController] Requisição de webhook recebida.');

    // Envia para o serviço processar em segundo plano
    webhookService.processIncomingMessage(req.body);

    // Responde imediatamente para a Z-API saber que recebemos
    res.status(200).json({ message: 'Webhook recebido com sucesso.' });
  }
}

module.exports = new WebhookController();