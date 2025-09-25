const logger = require('../../utils/logger');
const { MonitoredGroup, Category } = require('../../models'); // Importamos os models que usaremos em breve

class WebhookService {
  /**
   * Processa o payload de um webhook vindo da Z-API.
   * @param {object} payload - O corpo da requisição do webhook.
   */
  async processIncomingMessage(payload) {
    logger.info('-------------------------------------------');
    logger.info('[WebhookService] Novo webhook recebido!', payload);

    // Extrai informações chave do payload
    const groupId = payload.phone;
    const participant = payload.participant;
    const messageType = payload.type;
    const messageText = payload.message;
    const messageId = payload.messageId;

    // 1. Verificamos se é uma mensagem de um grupo
    if (!groupId || !groupId.endsWith('@g.us')) {
      logger.warn('[WebhookService] Mensagem ignorada: Não é de um grupo.');
      return;
    }

    // 2. Verificamos se o grupo está sendo monitorado pelo nosso sistema
    // TODO: No futuro, faremos uma busca no banco de dados.
    // const isMonitored = await MonitoredGroup.findOne({ where: { group_id: groupId, is_active: true } });
    // if (!isMonitored) {
    //   logger.warn(`[WebhookService] Mensagem ignorada: Grupo ${groupId} não está sendo monitorado.`);
    //   return;
    // }
    logger.info(`[WebhookService] Mensagem recebida no grupo monitorado: ${groupId}`);


    // 3. Verificamos se é um clique em um botão de uma mensagem anterior
    if (payload.buttonId) {
        logger.info(`[WebhookService] Detectado clique no botão com ID: ${payload.buttonId}`);
        // TODO: Implementar a lógica para lidar com cliques nos botões 'Editar' ou de seleção de categoria.
        return;
    }

    // 4. Lidamos com diferentes tipos de mensagem
    switch (messageType) {
      case 'image':
      case 'document':
      case 'audio':
        logger.info(`[WebhookService] Mensagem do tipo "${messageType}" recebida. URL da mídia: ${payload.mediaUrl}`);
        // TODO: Iniciar o fluxo de análise com IA para esta mídia.
        break;
      
      case 'text':
        logger.info(`[WebhookService] Mensagem de texto recebida: "${messageText}"`);
        // TODO: Verificar se o texto é um complemento para uma mídia enviada anteriormente.
        break;
      
      default:
        logger.warn(`[WebhookService] Tipo de mensagem "${messageType}" não é processado atualmente.`);
        break;
    }
  }
}

module.exports = new WebhookService();