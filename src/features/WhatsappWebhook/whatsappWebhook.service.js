const logger = require('../../utils/logger');
const { MonitoredGroup } = require('../../models');
const aiService = require('../../utils/aiService');
const whatsappService = require('../../utils/whatsappService');

class WebhookService {
  async processIncomingMessage(payload) {
    if (!payload.isGroup) return;

    const groupId = payload.phone;
    const isMonitored = await MonitoredGroup.findOne({
      where: { group_id: groupId, is_active: true },
    });
    
    if (!isMonitored) return;

    logger.info(`[WebhookService] >>> Mensagem recebida no grupo monitorado: ${isMonitored.name}`);

    const messageType = payload.type;
    const messageText = payload.text ? payload.text.message : null;
    let analysisResult = null;

    try {
      switch (messageType) {
        case 'image':
        case 'document':
          logger.info(`[WebhookService] Mídia do tipo "${messageType}" recebida. Iniciando análise...`);
          const imageBuffer = await whatsappService.downloadZapiMedia(payload.mediaUrl);
          if (imageBuffer) {
            // Usa a função de análise com imagem
            analysisResult = await aiService.analyzeExpenseWithImage(imageBuffer, messageText);
          }
          break;

        case 'audio':
          logger.info('[WebhookService] Mensagem de áudio recebida. Transcrevendo...');
          const audioBuffer = await whatsappService.downloadZapiMedia(payload.mediaUrl);
          if (audioBuffer) {
            const transcribedText = await aiService.transcribeAudio(audioBuffer);
            if (transcribedText) {
              // Usa a função de análise a partir do texto transcrito
              analysisResult = await aiService.analyzeExpenseFromText(transcribedText);
            }
          }
          break;
        
        // Podemos adicionar mais casos aqui no futuro (texto, etc.)
      }

      // Se a análise (de imagem ou áudio) foi bem-sucedida
      if (analysisResult) {
        console.log('✅✅✅ ANÁLISE DA IA COMPLETA ✅✅✅');
        console.log(analysisResult);
        console.log('✅✅✅ PRÓXIMO PASSO: INICIAR FLUXO DE VALIDAÇÃO ✅✅✅');

        // TODO: Salvar na tabela `pending_expenses` e enviar mensagem de validação.
      } else {
        logger.warn(`[WebhookService] Não foi possível obter um resultado da análise para a mensagem tipo "${messageType}".`);
      }

    } catch (error) {
      logger.error('[WebhookService] Ocorreu um erro no processamento do webhook:', error);
    }
  }
}

module.exports = new WebhookService();