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

    let analysisResult = null;
    let mediaUrl = null;
    let caption = null;
    let messageType = 'desconhecido';

    try {
      // --- LÓGICA DE DETECÇÃO CORRIGIDA ---
      if (payload.image) {
        messageType = 'imagem';
        mediaUrl = payload.image.imageUrl;
        caption = payload.image.caption;
      } else if (payload.document) {
        messageType = 'documento';
        mediaUrl = payload.document.documentUrl;
        caption = payload.document.caption;
      } else if (payload.audio) {
        messageType = 'áudio';
        mediaUrl = payload.audio.audioUrl; 
      } else if (payload.text) {
        messageType = 'texto';
      }
      // --- FIM DA LÓGICA DE DETECÇÃO ---

      // Agora, processamos com base no tipo detectado
      if (messageType === 'imagem' || messageType === 'documento') {
        logger.info(`[WebhookService] Mídia do tipo "${messageType}" recebida. Iniciando análise...`);
        const mediaBuffer = await whatsappService.downloadZapiMedia(mediaUrl);
        if (mediaBuffer) {
          analysisResult = await aiService.analyzeExpenseWithImage(mediaBuffer, caption);
        }
      } else if (messageType === 'áudio') {
        logger.info(`[WebhookService] Mensagem de "${messageType}" recebida. Transcrevendo...`);
        const audioBuffer = await whatsappService.downloadZapiMedia(mediaUrl);
        if (audioBuffer) {
          const transcribedText = await aiService.transcribeAudio(audioBuffer);
          if (transcribedText) {
            analysisResult = await aiService.analyzeExpenseFromText(transcribedText);
          }
        }
      } else {
        logger.info(`[WebhookService] Mensagem de "${messageType}" recebida. Ignorando para análise de despesa.`);
      }

      // Se a análise (de qualquer tipo de mídia) foi bem-sucedida
      if (analysisResult) {
        console.log('✅✅✅ ANÁLISE DA IA COMPLETA ✅✅✅');
        console.log(analysisResult);
        console.log('✅✅✅ PRÓXIMO PASSO: INICIAR FLUXO DE VALIDAÇÃO ✅✅✅');

        // TODO: Salvar na tabela `pending_expenses` e enviar mensagem de validação.
      } else if (messageType !== 'texto' && messageType !== 'desconhecido') {
        // Apenas loga aviso se for uma mídia que deveria ser analisada mas falhou
        logger.warn(`[WebhookService] Não foi possível obter um resultado da análise para a mensagem tipo "${messageType}".`);
      }

    } catch (error) {
      logger.error('[WebhookService] Ocorreu um erro no processamento do webhook:', error);
    }
  }
}

module.exports = new WebhookService();