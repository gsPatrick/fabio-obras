const logger = require('../../utils/logger');
const { MonitoredGroup } = require('../../models');

class WebhookService {
  async processIncomingMessage(payload) {
    // logger.info('-------------------------------------------');
    // logger.info('[WebhookService] Novo webhook recebido!', payload);

    // 1. Verificamos se é uma mensagem de um grupo
    if (!payload.isGroup) {
      //logger.warn('[WebhookService] Mensagem ignorada: Não é de um grupo.');
      return;
    }

    const groupId = payload.phone;

    // 2. Verificamos se o grupo está na nossa lista de monitoramento no BANCO DE DADOS
    const isMonitored = await MonitoredGroup.findOne({
      where: { group_id: groupId, is_active: true },
    });
    
    if (!isMonitored) {
      logger.warn(`[WebhookService] Mensagem ignorada: Grupo ${groupId} não está sendo monitorado.`);
      return;
    }

    // SE CHEGOU ATÉ AQUI, A MENSAGEM É DE UM GRUPO QUE QUEREMOS PROCESSAR!
    logger.info(`[WebhookService] >>> Mensagem recebida no grupo monitorado: ${isMonitored.name} (${groupId})`);

    const participant = payload.participantPhone;
    const messageType = payload.type;
    const messageText = payload.text ? payload.text.message : null;
    const messageId = payload.messageId;
    
    if (payload.buttonId) {
        logger.info(`[WebhookService] Detectado clique no botão com ID: ${payload.buttonId}`);
        // TODO: Lógica para cliques em botões
        return;
    }

    switch (messageType) {
      case 'image':
      case 'document':
      case 'audio':
        logger.info(`[WebhookService] Mensagem do tipo "${messageType}" de ${participant}. URL: ${payload.mediaUrl}`);
        // TODO: Iniciar o fluxo de análise com IA.
        break;
      
      case 'text':
        logger.info(`[WebhookService] Mensagem de texto "${messageText}" de ${participant}.`);
        // TODO: Verificar se é um complemento de mídia.
        break;
      
      default:
        logger.warn(`[WebhookService] Tipo de mensagem "${messageType}" não processado.`);
        break;
    }
  }
}

module.exports = new WebhookService();