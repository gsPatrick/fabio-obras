
const webhookService = require('./whatsappWebhook.service');
const logger = require('../../utils/logger');

class WebhookController {
  /**
   * Lida com a requisição POST do webhook da Z-API.
   */
  async handleWebhook(req, res) {
    logger.info('[WebhookController] Requisição de webhook recebida.');

    // Envia para o serviço processar em segundo plano
    webhookService.processIncomingMessage(req.body);

    // Responde imediatamente para a Z-API saber que recebemos
    res.status(200).json({ message: 'Webhook recebido com sucesso.' });
  }
}

module.exports = new WebhookController();