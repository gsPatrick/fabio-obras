const logger = require('../../utils/logger');
const { MonitoredGroup, Category, PendingExpense, Expense } = require('../../models');
const aiService = require('../../utils/aiService');
const whatsappService = require('../../utils/whatsappService');

class WebhookService {
  async processIncomingMessage(payload) {
    // --- LÓGICA DE DETECÇÃO DE CLIQUES (CORRIGIDA) ---
    if (payload.buttonsResponseMessage) {
      return this.handleButtonResponse(payload);
    }
    // Para a lista, usaremos uma chave mais provável baseada no padrão
    if (payload.listResponseMessage) {
      return this.handleListResponse(payload);
    }

    // --- LÓGICA DE RECEBIMENTO DE MENSAGENS ---
    if (!payload.isGroup) return;

    const groupId = payload.phone;
    const isMonitored = await MonitoredGroup.findOne({ where: { group_id: groupId, is_active: true } });
    if (!isMonitored) return;

    logger.info(`[WebhookService] >>> Mensagem recebida no grupo monitorado: ${isMonitored.name}`);

    let analysisResult = null;
    let mediaUrl = null;
    let caption = null;
    let messageType = 'desconhecido';

    try {
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
      }
      
      if (messageType === 'imagem' || messageType === 'documento') {
        const mediaBuffer = await whatsappService.downloadZapiMedia(mediaUrl);
        if (mediaBuffer) {
          analysisResult = await aiService.analyzeExpenseWithImage(mediaBuffer, caption);
        }
      } else if (messageType === 'áudio') {
        const audioBuffer = await whatsappService.downloadZapiMedia(mediaUrl);
        if (audioBuffer) {
          const transcribedText = await aiService.transcribeAudio(audioBuffer);
          if (transcribedText) {
            analysisResult = await aiService.analyzeExpenseFromText(transcribedText);
          }
        }
      }

      if (analysisResult) {
        await this.startValidationFlow(payload, analysisResult);
      }
    } catch (error) {
      logger.error('[WebhookService] Erro no processamento de nova mensagem:', error);
    }
  }

  async startValidationFlow(payload, analysisResult) {
    const { value, description, categoryName } = analysisResult;
    const groupId = payload.phone;
    const category = await Category.findOne({ where: { name: categoryName } });
    if (!category) {
      logger.error(`Categoria "${categoryName}" não encontrada no banco.`);
      return;
    }
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
    const pendingExpense = await PendingExpense.create({
      value,
      description,
      suggested_category_id: category.id,
      whatsapp_message_id: payload.messageId,
      whatsapp_group_id: groupId,
      participant_phone: payload.participantPhone,
      expires_at: expiresAt,
    });
    const formattedValue = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
    const message = `Análise concluída! 🤖\n\nDespesa de *${formattedValue}* foi sugerida para a categoria: *${category.name}*.\n\nSe estiver correto, não precisa fazer nada. Para corrigir, clique no botão abaixo.`;
    const buttons = [{ id: `edit_expense_${pendingExpense.id}`, label: '✏️ Editar Categoria' }];
    await whatsappService.sendButtonList(groupId, message, buttons);
    logger.info(`Fluxo de validação iniciado para a despesa pendente ID: ${pendingExpense.id}`);
  }

  async handleButtonResponse(payload) {
    // <<< CORREÇÃO PRINCIPAL AQUI >>>
    const buttonId = payload.buttonsResponseMessage.buttonId;
    const groupId = payload.phone;

    logger.info(`[WebhookService] Clique no botão detectado. ID: ${buttonId}`);

    if (buttonId && buttonId.startsWith('edit_expense_')) {
      const pendingExpenseId = buttonId.split('_')[2];
      const pendingExpense = await PendingExpense.findByPk(pendingExpenseId);
      if (!pendingExpense) {
        await whatsappService.sendWhatsappMessage(groupId, "Esta despesa não está mais pendente ou não foi encontrada.");
        return;
      }
      
      const allCategories = await Category.findAll({ order: [['type', 'ASC'], ['name', 'ASC']] });
      const options = allCategories.map(cat => ({
        id: `sel_cat_${cat.id}_exp_${pendingExpense.id}`,
        title: cat.name,
        description: `Tipo: ${cat.type}`
      }));

      logger.info(`[WebhookService] Enviando lista de ${options.length} categorias para o usuário escolher.`);
      await whatsappService.sendOptionList(groupId, "Selecione a categoria correta para a despesa:", {
        title: "Lista de Categorias",
        buttonLabel: "Ver Categorias",
        options: options,
      });
    }
  }

  async handleListResponse(payload) {
    // <<< CORREÇÃO PREVENTIVA AQUI >>>
    const optionId = payload.listResponseMessage.selectedRowId;
    const groupId = payload.phone;

    logger.info(`[WebhookService] Seleção na lista detectada. ID da Opção: ${optionId}`);

    if (optionId && optionId.startsWith('sel_cat_')) {
      const parts = optionId.split('_');
      const categoryId = parts[2];
      const pendingExpenseId = parts[4];
      const pendingExpense = await PendingExpense.findByPk(pendingExpenseId);
      const category = await Category.findByPk(categoryId);
      if (!pendingExpense || !category) {
        await whatsappService.sendWhatsappMessage(groupId, "Ocorreu um erro ao atualizar a despesa. Tente novamente.");
        return;
      }
      await Expense.create({
        value: pendingExpense.value,
        description: pendingExpense.description,
        expense_date: pendingExpense.createdAt,
        whatsapp_message_id: pendingExpense.whatsapp_message_id,
        category_id: category.id,
      });
      await pendingExpense.destroy();
      await whatsappService.sendWhatsappMessage(groupId, `✅ Categoria atualizada com sucesso para: *${category.name}*`);
      logger.info(`Despesa ${pendingExpenseId} confirmada com a categoria ${category.name} pelo usuário.`);
    }
  }
}

module.exports = new WebhookService();