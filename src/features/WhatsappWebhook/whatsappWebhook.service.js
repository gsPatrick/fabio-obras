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

    const messageText = payload.text ? payload.text.message : (payload.caption || null);
    let analysisResult = null;
    let messageTypeForLog = 'desconhecido';

    try {
      // <<< INÍCIO DA CORREÇÃO LÓGICA >>>
      // Em vez de 'payload.type', verificamos a existência de chaves de mídia.
      // A Z-API usa 'mimetype' ou chaves específicas como 'image', 'audio'.
      
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
            // A IA multimodal (gpt-4o) consegue ler PDFs como imagens.
            analysisResult = await aiService.analyzeExpenseWithImage(docBuffer, messageText);
        }
      }
      // <<< FIM DA CORREÇÃO LÓGICA >>>

      if (analysisResult) {
        console.log('✅✅✅ ANÁLISE DA IA COMPLETA ✅✅✅');
        console.log(analysisResult);
        console.log('✅✅✅ PRÓXIMO PASSO: INICIAR FLUXO DE VALIDAÇÃO ✅✅✅');
        // TODO: Salvar e enviar mensagem de validação.
      } else {
        // Ignora mensagens de texto puro ou tipos não suportados
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