const logger = require('../../utils/logger');
const { MonitoredGroup, Category, PendingExpense, Expense } = require('../../models');
const aiService = require('../../utils/aiService');
const whatsappService = require('../../utils/whatsappService');

class WebhookService {
  async processIncomingMessage(payload) {
    if (payload.buttonsResponseMessage) {
      return this.handleEditButton(payload);
    }
    
    if (!payload.isGroup) return;

    const groupId = payload.phone;
    const isMonitored = await MonitoredGroup.findOne({ where: { group_id: groupId, is_active: true } });
    if (!isMonitored) return;

    const textMessage = payload.text ? payload.text.message : null;
    if (textMessage && /^\d+$/.test(textMessage)) {
      const handled = await this.handleNumericReply(groupId, parseInt(textMessage, 10));
      if (handled) return;
    }

    let analysisResult = null;
    let mediaUrl = null;
    let caption = null;
    try {
      if (payload.image) {
        mediaUrl = payload.image.imageUrl;
        caption = payload.image.caption;
      } else if (payload.document) {
        mediaUrl = payload.document.documentUrl;
        caption = payload.document.caption;
      } else if (payload.audio) {
        mediaUrl = payload.audio.audioUrl;
      }
      
      if (mediaUrl) {
        const mediaBuffer = await whatsappService.downloadZapiMedia(mediaUrl);
        if (mediaBuffer) {
          if (payload.audio) {
            const transcribedText = await aiService.transcribeAudio(mediaBuffer);
            if (transcribedText) analysisResult = await aiService.analyzeExpenseFromText(transcribedText);
          } else {
            analysisResult = await aiService.analyzeExpenseWithImage(mediaBuffer, caption);
          }
        }
      }
      if (analysisResult) await this.startValidationFlow(payload, analysisResult);
    } catch (error) {
      logger.error('[WebhookService] Erro no processamento de nova mensagem:', error);
    }
  }

  /**
   * MENSAGEM 1: Sugestão da IA (Atratrativa e Clara)
   */
  async startValidationFlow(payload, analysisResult) {
    const { value, description, categoryName } = analysisResult;
    const groupId = payload.phone;
    const category = await Category.findOne({ where: { name: categoryName } });
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
    const pendingExpense = await PendingExpense.create({
      value,
      description,
      suggested_category_id: category.id,
      whatsapp_message_id: payload.messageId,
      whatsapp_group_id: groupId,
      participant_phone: payload.participantPhone,
      expires_at: expiresAt,
      status: 'awaiting_validation',
    });

    const formattedValue = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
    
    // --- MENSAGEM MELHORADA ---
    const message = `🧾 *Novo Registro de Custo* 🧾\n\n` +
                    `💰 *Valor:* ${formattedValue}\n` +
                    `📄 *Descrição:* ${description}\n` +
                    `🤖 *Sugestão de Categoria:* *${category.name}*\n\n` +
                    `Nenhuma ação é necessária se estiver correto. Para alterar, clique em *Editar* em até 5 minutos.`;

    const buttons = [{ id: `edit_expense_${pendingExpense.id}`, label: '✏️ Editar Categoria' }];
    await whatsappService.sendButtonList(groupId, message, buttons);
    logger.info(`Fluxo de validação iniciado para a despesa pendente ID: ${pendingExpense.id}`);
  }

  /**
   * MENSAGEM 2: Lista Numerada de Categorias (Instruções Claras)
   */
  async handleEditButton(payload) {
    const buttonId = payload.buttonsResponseMessage.buttonId;
    const groupId = payload.phone;
    if (buttonId && buttonId.startsWith('edit_expense_')) {
      const pendingExpenseId = buttonId.split('_')[2];
      const pendingExpense = await PendingExpense.findByPk(pendingExpenseId);
      
      if (!pendingExpense) {
        // --- MENSAGEM DE ERRO MELHORADA ---
        const errorMessage = `⏳ *Tempo Esgotado* ⏳\n\nO prazo para editar esta despesa já expirou e ela foi confirmada automaticamente.`;
        await whatsappService.sendWhatsappMessage(groupId, errorMessage);
        return;
      }
      
      const allCategories = await Category.findAll({ order: [['id', 'ASC']] });
      const categoryListText = allCategories
        .map((cat, index) => `${index + 1} - ${cat.name}`)
        .join('\n');
      
      // --- MENSAGEM MELHORADA ---
      const message = `📋 *Selecione a Categoria Correta* 📋\n\n` +
                      `Responda esta mensagem apenas com o *número* da opção desejada. 👇\n\n` +
                      `${categoryListText}`;
      
      pendingExpense.status = 'awaiting_category_reply';
      await pendingExpense.save();
      
      await whatsappService.sendWhatsappMessage(groupId, message);
      logger.info(`Enviada lista de categorias numeradas para a despesa pendente ID: ${pendingExpenseId}`);
    }
  }

  /**
   * MENSAGEM 3 e 4: Confirmação Final e Erro de Número Inválido
   */
  async handleNumericReply(groupId, selectedNumber) {
    const pendingExpense = await PendingExpense.findOne({
      where: { whatsapp_group_id: groupId, status: 'awaiting_category_reply' },
    });

    if (!pendingExpense) return false;

    const allCategories = await Category.findAll({ order: [['id', 'ASC']] });
    const selectedCategory = allCategories[selectedNumber - 1];

    if (!selectedCategory) {
      // --- MENSAGEM DE ERRO MELHORADA ---
      const totalCategories = allCategories.length;
      const errorMessage = `⚠️ *Opção Inválida!*\n\n` +
                           `O número *${selectedNumber}* não está na lista. Por favor, responda novamente com um número entre 1 e ${totalCategories}.`;
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

    // --- MENSAGEM DE SUCESSO MELHORADA ---
    const successMessage = `🗂️ *Tudo Certo!*\n\n` +
                           `Sua despesa foi organizada e registrada na categoria:\n` +
                           `*${selectedCategory.name}*`;

    await whatsappService.sendWhatsappMessage(groupId, successMessage);
    logger.info(`Despesa ${pendingExpense.id} confirmada com a categoria ${selectedCategory.name} via resposta numérica.`);
    
    return true;
  }
}

module.exports = new WebhookService();