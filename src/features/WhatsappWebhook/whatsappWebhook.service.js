// src/features/WhatsappWebhook/whatsappWebhook.service.js
'use strict';

const logger = require('../../utils/logger');
const { MonitoredGroup, Category, PendingExpense, Expense } = require('../../models');
const { Op } = require('sequelize');
const aiService = require('../../utils/aiService');
const whatsappService = require('../../utils/whatsappService');

// Tempo em minutos que o bot esperará pelo contexto (áudio/texto) após receber uma imagem.
const CONTEXT_WAIT_TIME_MINUTES = 2;

class WebhookService {
  async processIncomingMessage(payload) {
    // Roteador de Ações: primeiro verifica cliques em botões.
    if (payload.buttonsResponseMessage) {
      return this.handleEditButton(payload);
    }
    
    // Ignora mensagens que não são de grupos.
    if (!payload.isGroup) return;

    // Ignora eventos sem um remetente identificado (ex: alguém entrou no grupo).
    const participantPhone = payload.participantPhone;
    if (!participantPhone) {
        logger.warn('[Webhook] Ignorando evento sem identificação do participante.');
        return;
    }

    // Verifica se o grupo está sendo monitorado.
    const isMonitored = await MonitoredGroup.findOne({ where: { group_id: payload.phone, is_active: true } });
    if (!isMonitored) return;
    
    // Direciona para a função correta com base no tipo de conteúdo.
    if (payload.image || payload.document) {
      return this.handleMediaArrival(payload);
    }

    if (payload.audio || payload.text) {
      return this.handleContextArrival(payload);
    }
  }

  /**
   * ETAPA 1: Lida com a chegada de uma imagem/documento.
   * Cria um registro 'awaiting_context' e envia uma confirmação curta para o usuário.
   */
  async handleMediaArrival(payload) {
    const groupId = payload.phone;
    const participantPhone = payload.participantPhone;
    
    const mediaUrl = payload.image ? payload.image.imageUrl : payload.document.documentUrl;
    const mimeType = payload.image ? payload.image.mimeType : payload.document.mimeType;
    
    // Limpa pendências antigas do mesmo usuário para evitar confusão.
    await PendingExpense.destroy({
      where: {
        participant_phone: participantPhone,
        whatsapp_group_id: groupId,
        status: 'awaiting_context',
      }
    });

    // Cria um novo registro de espera.
    await PendingExpense.create({
      whatsapp_message_id: payload.messageId,
      whatsapp_group_id: groupId,
      participant_phone: participantPhone,
      attachment_url: mediaUrl,
      attachment_mimetype: mimeType, // Salva o tipo do arquivo
      status: 'awaiting_context',
      expires_at: new Date(Date.now() + CONTEXT_WAIT_TIME_MINUTES * 60 * 1000),
    });

    const confirmationMessage = `📄👍 Documento recebido! Agora estou aguardando a descrição por texto ou áudio.`;
    await whatsappService.sendWhatsappMessage(groupId, confirmationMessage);

    logger.info(`[Webhook] Mídia (${mimeType}) de ${participantPhone} recebida. Mensagem de confirmação enviada.`);
  }

  /**
   * ETAPA 2: Lida com a chegada de texto/áudio.
   * Verifica se é um contexto para uma mídia pendente ou uma resposta numérica para edição.
   */
 async handleContextArrival(payload) {
    const groupId = payload.phone;
    const participantPhone = payload.participantPhone;

    const pendingMedia = await PendingExpense.findOne({
      where: {
        participant_phone: participantPhone,
        whatsapp_group_id: groupId,
        status: 'awaiting_context',
        expires_at: { [Op.gt]: new Date() }
      },
      order: [['createdAt', 'DESC']]
    });

    if (pendingMedia) {
      const workingMessage = `Ok, recebi a descrição! Analisando tudo agora... 🤖`;
      await whatsappService.sendWhatsappMessage(payload.phone, workingMessage);

      logger.info(`[Webhook] Contexto de ${participantPhone} recebido. Iniciando análise...`);
      let userContext = '';
      if (payload.audio) {
        const audioBuffer = await whatsappService.downloadZapiMedia(payload.audio.audioUrl);
        userContext = audioBuffer ? await aiService.transcribeAudio(audioBuffer) : '';
      } else {
        userContext = payload.text.message;
      }
      
      const mediaBuffer = await whatsappService.downloadZapiMedia(pendingMedia.attachment_url);

      if (mediaBuffer && userContext) {
        const analysisResult = await aiService.analyzeExpenseWithImage(mediaBuffer, userContext, pendingMedia.attachment_mimetype);
        
        // <<< INÍCIO DA CORREÇÃO >>>
        if (analysisResult) {
          // Se a análise deu certo, continua o fluxo normal.
          return this.startValidationFlow(pendingMedia, analysisResult, userContext);
        } else {
          // Se a análise falhou (retornou null), informa o usuário e limpa a pendência.
          logger.error(`[Webhook] A análise da IA falhou para a mídia de ${participantPhone}.`);
          const errorMessage = `❌ Desculpe, não consegui analisar o documento. Por favor, tente enviar a imagem/PDF e a descrição novamente.`;
          await whatsappService.sendWhatsappMessage(payload.phone, errorMessage);
          await pendingMedia.destroy(); // Limpa a pendência para permitir uma nova tentativa
        }
        // <<< FIM DA CORREÇÃO >>>

      }
      // Adicionado um 'else' para o caso de um dos buffers falhar
      else {
          logger.error(`[Webhook] Falha ao baixar mídia ou transcrever áudio para ${participantPhone}.`);
          const errorMessage = `❌ Ocorreu um erro ao processar o arquivo ou o áudio. Por favor, tente novamente.`;
          await whatsappService.sendWhatsappMessage(payload.phone, errorMessage);
          await pendingMedia.destroy();
      }

    } else {
      // Se não era um contexto, pode ser uma resposta para edição.
      const textMessage = payload.text ? payload.text.message : null;
      if (textMessage && /^\d+$/.test(textMessage)) {
        await this.handleNumericReply(groupId, parseInt(textMessage, 10), participantPhone);
      }
    }
  }

  /**
   * ETAPA 3: Monta e envia a mensagem rica de validação após a análise da IA.
   */
  async startValidationFlow(pendingExpense, analysisResult, userContext) {
    const { value, documentType, payer, receiver, baseDescription, categoryName } = analysisResult;
    const finalDescriptionForDB = `${baseDescription} (${userContext})`;
    const category = await Category.findOne({ where: { name: categoryName } });
    if (!category) return;

    // Atualiza o registro pendente com os dados da IA.
    pendingExpense.value = value;
    pendingExpense.description = finalDescriptionForDB;
    pendingExpense.suggested_category_id = category.id;
    pendingExpense.status = 'awaiting_validation';
    pendingExpense.expires_at = new Date(Date.now() + 3 * 60 * 1000); // 3 minutos para validar/editar
    await pendingExpense.save();
    
    const formattedValue = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
    
    let analysisText = `\n\n*🔬 Análise do Documento:*\n` +
                       `-----------------------------------\n` +
                       `*Tipo:* ${documentType}\n` +
                       `*Valor:* ${formattedValue}\n` +
                       `*Pagador:* ${payer}\n` +
                       `*Recebedor:* ${receiver}\n` +
                       `*Descrição (IA):* ${baseDescription}\n` +
                       `-----------------------------------`;

    const message = `🧾 *Novo Custo Registrado* 🧾\n\n` +
                    `👤 *Enviado por:* ${pendingExpense.participant_phone}\n` +
                    `💬 *Contexto do Usuário:* _${userContext}_\n` +
                    `${analysisText}\n\n` +
                    `✅ *Categoria Definida:* \n` +
                    `*➡️ ${category.name} ⬅️*\n\n` +
                    `Se a categoria estiver incorreta, clique em *Corrigir*. Caso contrário, nenhuma ação é necessária.`;

    const buttons = [{ id: `edit_expense_${pendingExpense.id}`, label: '✏️ Corrigir Categoria' }];
    await whatsappService.sendButtonList(pendingExpense.whatsapp_group_id, message, buttons);
  }

  /**
   * ETAPA 4: Usuário clica no botão "Corrigir".
   */
  async handleEditButton(payload) {
    const buttonId = payload.buttonsResponseMessage.buttonId;
    const groupId = payload.phone;
    const clickerPhone = payload.participantPhone;

    if (buttonId && buttonId.startsWith('edit_expense_')) {
      const pendingExpenseId = buttonId.split('_')[2];
      const pendingExpense = await PendingExpense.findByPk(pendingExpenseId);
      
      if (!pendingExpense) {
        const errorMessage = `⏳ *Tempo Esgotado* ⏳\n\nO prazo para editar esta despesa já expirou.`;
        await whatsappService.sendWhatsappMessage(groupId, errorMessage);
        return;
      }

      if (pendingExpense.participant_phone !== clickerPhone) {
        const warningMessage = `🤚 *Atenção, ${clickerPhone}!* \n\nApenas a pessoa que registrou a despesa (${pendingExpense.participant_phone}) pode editá-la.`;
        await whatsappService.sendWhatsappMessage(groupId, warningMessage);
        return;
      }
      
      const allCategories = await Category.findAll({ order: [['id', 'ASC']] });
      const categoryListText = allCategories.map((cat, index) => `${index + 1} - ${cat.name}`).join('\n');
      
      const message = `📋 *Olá, ${clickerPhone}!* \n\n` +
                      `Você está editando a despesa:\n` +
                      `*Valor:* ${new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(pendingExpense.value)}\n` +
                      `*Descrição:* ${pendingExpense.description}\n\n` +
                      `Para qual categoria você quer alterar? Responda apenas com o *número* da opção. 👇\n\n` +
                      `${categoryListText}`;
      
      pendingExpense.status = 'awaiting_category_reply';
      pendingExpense.expires_at = new Date(Date.now() + 3 * 60 * 1000); // 3 minutos para responder
      await pendingExpense.save();
      
      await whatsappService.sendWhatsappMessage(groupId, message);
    }
  }

  /**
   * ETAPA 5: Usuário responde com um número para finalizar a edição.
   */
  async handleNumericReply(groupId, selectedNumber, participantPhone) {
    const pendingExpense = await PendingExpense.findOne({
      where: {
        whatsapp_group_id: groupId,
        participant_phone: participantPhone,
        status: 'awaiting_category_reply',
      },
    });

    if (!pendingExpense) {
      logger.warn(`[Webhook] Resposta numérica de ${participantPhone} ignorada, pois não havia pendência para ele.`);
      return false;
    }

    const allCategories = await Category.findAll({ order: [['id', 'ASC']] });
    const selectedCategory = allCategories[selectedNumber - 1];
    
    if (!selectedCategory) {
      const totalCategories = allCategories.length;
      const errorMessage = `⚠️ *Opção Inválida, ${participantPhone}!* \n\nO número *${selectedNumber}* não está na lista. Responda com um número entre 1 e ${totalCategories}.`;
      await whatsappService.sendWhatsappMessage(groupId, errorMessage);
      return true;
    }

    await Expense.create({
      value: pendingExpense.value,
      description: pendingExpense.description,
      expense_date: pendingExpense.createdAt,
      whatsapp_message_id: pendingExpense.whatsapp_message_id,
      category_id: selectedCategory.id,
    });
    
    await pendingExpense.destroy();
    
    const successMessage = `🗂️ *Confirmado, ${participantPhone}!* \n\nSua despesa foi registrada na categoria:\n*${selectedCategory.name}*`;
    await whatsappService.sendWhatsappMessage(groupId, successMessage);
    
    return true;
  }
}

module.exports = new WebhookService();