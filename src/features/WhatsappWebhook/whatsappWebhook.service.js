const logger = require('../../utils/logger');
const { MonitoredGroup } = require('../../models');
const aiService = require('../../utils/aiService');
const whatsappService = require('../../utils/whatsappService');

class WebhookService {
  async processIncomingMessage(payload) {
    // ===================================================================
    // <<< LOG DE DEPURAÇÃO ADICIONADO AQUI >>>
    // Vamos inspecionar o objeto completo que a Z-API nos envia.
    console.log('--- INÍCIO DO PAYLOAD BRUTO RECEBIDO ---');
    console.log(JSON.stringify(payload, null, 2)); // Usando JSON.stringify para formatar e ver tudo.
    console.log('--- FIM DO PAYLOAD BRUTO RECEBIDO ---');
    // ===================================================================

    if (!payload.isGroup) return;

    const groupId = payload.phone;
    const isMonitored = await MonitoredGroup.findOne({
      where: { group_id: groupId, is_active: true },
    });
    
    if (!isMonitored) return;

    logger.info(`[WebhookService] >>> Mensagem recebida no grupo monitorado: ${isMonitored.name}`);

    // Mantemos a lógica anterior por enquanto. Ela vai falhar, mas o log acima nos dará a resposta.
    const messageText = payload.text ? payload.text.message : (payload.caption || null);
    let analysisResult = null;
    let messageTypeForLog = 'desconhecido';

    try {
      if (payload.mimetype && payload.mimetype.startsWith('image')) {
        messageTypeForLog = 'imagem';
        logger.info(`[WebhookService] Mídia do tipo "${messageTypeForLog}" recebida. Iniciando análise...`);
        const imageBuffer = await whatsappService.downloadZapiMedia(payload.mediaUrl);
        if (imageBuffer) {
          analysisResult = await aiService.analyzeExpenseWithImage(imageBuffer, messageText);
        }
      } else if (payload.mimetype && payload.mimetype.startsWith('audio')) {
        messageTypeForLog = 'áudio';
        logger.info(`[WebhookService] Mensagem de "${messageTypeForLog}" recebida. Transcrevendo...`);
        const audioBuffer = await whatsappService.downloadZapiMedia(payload.mediaUrl);
        if (audioBuffer) {
          const transcribedText = await aiService.transcribeAudio(audioBuffer);
          if (transcribedText) {
            analysisResult = await aiService.analyzeExpenseFromText(transcribedText);
          }
        }
      } else if (payload.mimetype && payload.mimetype.includes('pdf')) {
        messageTypeForLog = 'documento (PDF)';
        logger.info(`[WebhookService] Mídia do tipo "${messageTypeForLog}" recebida. Tratando como imagem.`);
        const docBuffer = await whatsappService.downloadZapiMedia(payload.mediaUrl);
        if (docBuffer) {
            analysisResult = await aiService.analyzeExpenseWithImage(docBuffer, messageText);
        }
      }

      if (analysisResult) {
        console.log('✅✅✅ ANÁLISE DA IA COMPLETA ✅✅✅');
        console.log(analysisResult);
        console.log('✅✅✅ PRÓXIMO PASSO: INICIAR FLUXO DE VALIDAÇÃO ✅✅✅');
      } else {
        if (messageTypeForLog === 'desconhecido') {
            logger.info('[WebhookService] Mensagem de texto puro ou tipo não processável recebida. Ignorando.');
        } else {
            logger.warn(`[WebhookService] Não foi possível obter um resultado da análise para a mensagem tipo "${messageTypeForLog}".`);
        }
      }
    } catch (error) {
      logger.error('[WebhookService] Ocorreu um erro no processamento do webhook:', error);
    }
  }
}

module.exports = new WebhookService();