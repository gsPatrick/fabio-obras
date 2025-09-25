const logger = require('../../utils/logger');
// <<< INÍCIO DA CORREÇÃO >>>
const { MonitoredGroup, Category, PendingExpense, Expense } = require('../../models');
const { Op } = require('sequelize');
// <<< FIM DA CORREÇÃO >>>
const aiService = require('../../utils/aiService');
const whatsappService = require('../../utils/whatsappService');

const CONTEXT_WAIT_TIME_MINUTES = 2;

class WebhookService {
  async processIncomingMessage(payload) {
    if (payload.buttonsResponseMessage) {
      return this.handleEditButton(payload);
    }
    if (!payload.isGroup) return;

    const participantPhone = payload.participantPhone;
    if (!participantPhone) return;

    const isMonitored = await MonitoredGroup.findOne({ where: { group_id: payload.phone, is_active: true } });
    if (!isMonitored) return;
    
    if (payload.image || payload.document) {
      return this.handleMediaArrival(payload);
    }

    if (payload.audio || payload.text) {
      return this.handleContextArrival(payload);
    }
  }

  async handleMediaArrival(payload) {
    const groupId = payload.phone;
    const participantPhone = payload.participantPhone;
    logger.info(`[Webhook] Mídia recebida de ${participantPhone}. Aguardando contexto.`);
    const mediaUrl = payload.image ? payload.image.imageUrl : payload.document.documentUrl;

    await PendingExpense.destroy({
      where: {
        participant_phone: participantPhone,
        whatsapp_group_id: groupId,
        status: 'awaiting_context',
      }
    });

    await PendingExpense.create({
      whatsapp_message_id: payload.messageId,
      whatsapp_group_id: groupId,
      participant_phone: participantPhone,
      attachment_url: mediaUrl,
      status: 'awaiting_context',
      expires_at: new Date(Date.now() + CONTEXT_WAIT_TIME_MINUTES * 60 * 1000),
    });
  }

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
      logger.info(`[Webhook] Contexto de ${participantPhone} recebido. Iniciando análise...`);
      let contextText = '';
      if (payload.audio) {
        const audioBuffer = await whatsappService.downloadZapiMedia(payload.audio.audioUrl);
        contextText = audioBuffer ? await aiService.transcribeAudio(audioBuffer) : '';
      } else {
        contextText = payload.text.message;
      }
      
      const mediaBuffer = await whatsappService.downloadZapiMedia(pendingMedia.attachment_url);
      if (mediaBuffer && contextText) {
        const analysisResult = await aiService.analyzeExpenseWithImage(mediaBuffer, contextText);
        if (analysisResult) {
          return this.startValidationFlow(pendingMedia, analysisResult);
        }
      }
    } else {
      const textMessage = payload.text ? payload.text.message : null;
      if (textMessage && /^\d+$/.test(textMessage)) {
        await this.handleNumericReply(groupId, parseInt(textMessage, 10), participantPhone);
      }
    }
  }

  async startValidationFlow(pendingExpense, analysisResult) {
    const { value, description, categoryName } = analysisResult;
    const category = await Category.findOne({ where: { name: categoryName } });
    if (!category) return;

    pendingExpense.value = value;
    pendingExpense.description = description;
    pendingExpense.suggested_category_id = category.id;
    pendingExpense.status = 'awaiting_validation';
    pendingExpense.expires_at = new Date(Date.now() + 5 * 60 * 1000);
    await pendingExpense.save();
    
    const formattedValue = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
    const message = `🧾 *Novo Registro de Custo* 🧾\n\n` +
                    `👤 *Registrado por:* ${pendingExpense.participant_phone}\n` +
                    `💰 *Valor:* ${formattedValue}\n` +
                    `📄 *Descrição:* ${description}\n` +
                    `🤖 *Sugestão de Categoria:* *${category.name}*\n\n` +
                    `Correto? Nenhuma ação necessária. Para alterar, clique em *Editar*.`;
    const buttons = [{ id: `edit_expense_${pendingExpense.id}`, label: '✏️ Editar Categoria' }];
    await whatsappService.sendButtonList(pendingExpense.whatsapp_group_id, message, buttons);
  }

  async handleEditButton(payload) {
    const buttonId = payload.buttonsResponseMessage.buttonId;
    const groupId = payload.phone;
    const clickerPhone = payload.participantPhone; // Quem clicou no botão

    if (buttonId && buttonId.startsWith('edit_expense_')) {
      const pendingExpenseId = buttonId.split('_')[2];
      const pendingExpense = await PendingExpense.findByPk(pendingExpenseId);
      if (!pendingExpense) {
        // ... (código de tempo esgotado)
        return;
      }

      // <<< VALIDAÇÃO >>>
      // A pessoa que clicou é a mesma que registrou?
      if (pendingExpense.participant_phone !== clickerPhone) {
        const warningMessage = `🤚 *Atenção, ${clickerPhone}!* \n\nApenas a pessoa que registrou a despesa (${pendingExpense.participant_phone}) pode editá-la.`;
        await whatsappService.sendWhatsappMessage(groupId, warningMessage);
        return;
      }
      
      const allCategories = await Category.findAll({ order: [['id', 'ASC']] });
      const categoryListText = allCategories.map((cat, index) => `${index + 1} - ${cat.name}`).join('\n');
      const message = `📋 *Olá, ${clickerPhone}!* \n\nPara qual categoria você quer alterar sua despesa de *${new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(pendingExpense.value)}*?\n\nResponda apenas com o *número* da opção. 👇\n\n${categoryListText}`;
      pendingExpense.status = 'awaiting_category_reply';
      await pendingExpense.save();
      await whatsappService.sendWhatsappMessage(groupId, message);
    }
  }

  async handleNumericReply(groupId, selectedNumber, participantPhone) {
    // <<< CORREÇÃO CRUCIAL >>>
    // Agora, procuramos uma despesa esperando resposta DESTE PARTICIPANTE.
    const pendingExpense = await PendingExpense.findOne({
      where: {
        whatsapp_group_id: groupId,
        participant_phone: participantPhone, // Apenas o autor pode responder
        status: 'awaiting_category_reply',
      },
    });

    if (!pendingExpense) {
      // Se a resposta numérica não veio de quem deveria, o sistema ignora.
      // Poderíamos enviar uma mensagem de "Não estou esperando uma resposta sua",
      // mas o silêncio é muitas vezes a melhor abordagem para não poluir o grupo.
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