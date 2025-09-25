const logger = require('../../utils/logger');
const { MonitoredGroup, Category, PendingExpense, Expense } = require('../../models');
const aiService = require('../../utils/aiService');
const whatsappService = require('../../utils/whatsappService');

class WebhookService {
  async processIncomingMessage(payload) {
    // --- LÓGICA DE DETECÇÃO DE CLIQUES ---
    if (payload.buttonsResponseMessage) {
      return this.handleEditButton(payload);
    }
    if (payload.listResponseMessage) {
      const selectedId = payload.listResponseMessage.selectedRowId;
      // Roteia para a função correta dependendo do ID selecionado
      if (selectedId.startsWith('show_submenu_')) {
        return this.handleMainMenuSelection(payload);
      }
      if (selectedId.startsWith('sel_cat_')) {
        return this.handleFinalCategorySelection(payload);
      }
    }

    // --- LÓGICA DE RECEBIMENTO DE MENSAGENS ---
    // (Esta parte permanece a mesma)
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
        if (mediaBuffer) analysisResult = await aiService.analyzeExpenseWithImage(mediaBuffer, caption);
      } else if (messageType === 'áudio') {
        const audioBuffer = await whatsappService.downloadZapiMedia(mediaUrl);
        if (audioBuffer) {
          const transcribedText = await aiService.transcribeAudio(audioBuffer);
          if (transcribedText) analysisResult = await aiService.analyzeExpenseFromText(transcribedText);
        }
      }
      if (analysisResult) await this.startValidationFlow(payload, analysisResult);
    } catch (error) {
      logger.error('[WebhookService] Erro no processamento de nova mensagem:', error);
    }
  }

  // ETAPA 1: Inicia o fluxo
  async startValidationFlow(payload, analysisResult) {
    // ... (Esta função permanece a mesma)
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

  // ETAPA 2: Usuário clica em "Editar". Enviamos o MENU PRINCIPAL.
  async handleEditButton(payload) {
    const buttonId = payload.buttonsResponseMessage.buttonId;
    const groupId = payload.phone;
    logger.info(`[WebhookService] Clique no botão detectado. ID: ${buttonId}`);
    if (buttonId && buttonId.startsWith('edit_expense_')) {
      const pendingExpenseId = buttonId.split('_')[2];
      const pendingExpense = await PendingExpense.findByPk(pendingExpenseId);
      if (!pendingExpense) {
        await whatsappService.sendWhatsappMessage(groupId, "Esta despesa não está mais pendente.");
        return;
      }
      
      // Busca os TIPOS de categoria únicos do banco (Mão de Obra, Material, etc)
      const mainCategories = await Category.findAll({
        group: ['type'],
        attributes: ['type'],
        order: [['type', 'ASC']],
      });

      const options = mainCategories.map(cat => ({
        id: `show_submenu_${cat.type.replace(/ /g, '_')}_exp_${pendingExpense.id}`, // ex: show_submenu_Mão_de_Obra_exp_2
        title: cat.type.substring(0, 24), // Limite de caracteres do WhatsApp
        description: `Ver opções de ${cat.type}`.substring(0, 72)
      }));

      logger.info(`[WebhookService] Enviando menu principal de categorias.`);
      await whatsappService.sendOptionList(groupId, "Selecione o tipo principal da despesa:", {
        title: "Tipos de Categoria",
        buttonLabel: "Ver Tipos",
        options: options,
      });
    }
  }

  // ETAPA 3: Usuário seleciona um TIPO. Enviamos o SUBMENU.
  async handleMainMenuSelection(payload) {
    const optionId = payload.listResponseMessage.selectedRowId;
    const groupId = payload.phone;
    logger.info(`[WebhookService] Seleção no menu principal: ${optionId}`);

    const parts = optionId.split('_');
    const categoryType = parts[2].replace(/_/g, ' '); // ex: Mão de Obra
    const pendingExpenseId = parts[4];

    // Busca todas as categorias DENTRO do tipo selecionado
    const subCategories = await Category.findAll({
      where: { type: categoryType },
      order: [['name', 'ASC']],
    });
    
    const options = subCategories.map(cat => ({
      id: `sel_cat_${cat.id}_exp_${pendingExpenseId}`, // ID para seleção final
      title: cat.name.substring(0, 24),
      description: `Tipo: ${cat.type}`.substring(0, 72)
    }));

    logger.info(`[WebhookService] Enviando submenu para o tipo "${categoryType}".`);
    await whatsappService.sendOptionList(groupId, `Agora selecione a categoria específica para *${categoryType}*:`, {
      title: `Categorias de ${categoryType}`,
      buttonLabel: "Ver Opções",
      options: options.slice(0, 10), // Garante o limite de 10 por lista
    });
    
    // TODO: Adicionar lógica de paginação se um tipo tiver mais de 10 categorias.
    // Por agora, sua lista se encaixa perfeitamente.
  }

  // ETAPA 4: Usuário faz a seleção FINAL. Salvamos e confirmamos.
  async handleFinalCategorySelection(payload) {
    const optionId = payload.listResponseMessage.selectedRowId;
    const groupId = payload.phone;
    logger.info(`[WebhookService] Seleção final de categoria: ${optionId}`);
    
    const parts = optionId.split('_');
    const categoryId = parts[2];
    const pendingExpenseId = parts[4];
    const pendingExpense = await PendingExpense.findByPk(pendingExpenseId);
    const category = await Category.findByPk(categoryId);
    
    if (!pendingExpense || !category) {
      await whatsappService.sendWhatsappMessage(groupId, "Ocorreu um erro ao atualizar. Tente novamente.");
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

module.exports = new WebhookService();