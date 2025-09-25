const logger = require('../../utils/logger');
const { MonitoredGroup, Category, PendingExpense, Expense, Sequelize } = require('../../models');
const aiService = require('../../utils/aiService');
const whatsappService = require('../../utils/whatsappService');

class WebhookService {
  async processIncomingMessage(payload) {
    // --- LÓGICA DE CLIQUE EM BOTÃO / LISTA ---
    // A Z-API envia um payload diferente para cliques, então tratamos primeiro.
    if (payload.buttonResponseMessage) {
      return this.handleButtonResponse(payload);
    }
    if (payload.listResponseMessage) {
      return this.handleListResponse(payload);
    }

    // --- LÓGICA DE RECEBIMENTO DE MENSAGEM (IMAGEM, ÁUDIO, ETC) ---
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
        // Inicia o fluxo de validação
        await this.startValidationFlow(payload, analysisResult);
      }
    } catch (error) {
      logger.error('[WebhookService] Erro no processamento de nova mensagem:', error);
    }
  }

  /**
   * Salva a análise da IA como uma despesa pendente e envia a mensagem de validação.
   */
  async startValidationFlow(payload, analysisResult) {
    const { value, description, categoryName } = analysisResult;
    const groupId = payload.phone;

    // 1. Encontrar a categoria no nosso banco de dados
    const category = await Category.findOne({ where: { name: categoryName } });
    if (!category) {
      logger.error(`Categoria "${categoryName}" não encontrada no banco de dados.`);
      return;
    }

    // 2. Criar a despesa pendente com validade de 5 minutos
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

    // 3. Enviar a mensagem de validação com o botão "Editar"
    const formattedValue = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
    const message = `Análise concluída! 🤖\n\nDespesa de *${formattedValue}* foi sugerida para a categoria: *${category.name}*.\n\nSe estiver correto, não precisa fazer nada. Para corrigir, clique no botão abaixo.`;
    const buttons = [{ id: `edit_expense_${pendingExpense.id}`, label: '✏️ Editar Categoria' }];
    
    await whatsappService.sendButtonList(groupId, message, buttons);
    logger.info(`Fluxo de validação iniciado para a despesa pendente ID: ${pendingExpense.id}`);
  }

  /**
   * Lida com cliques no botão "Editar".
   */
  async handleButtonResponse(payload) {
    const buttonId = payload.buttonResponseMessage.selectedButtonId;
    const groupId = payload.phone;

    if (buttonId && buttonId.startsWith('edit_expense_')) {
      const pendingExpenseId = buttonId.split('_')[2];
      const pendingExpense = await PendingExpense.findByPk(pendingExpenseId);

      if (!pendingExpense) {
        await whatsappService.sendWhatsappMessage(groupId, "Esta despesa não está mais pendente ou não foi encontrada.");
        return;
      }

      // TODO: Adicionar verificação de expiração aqui

      // Enviar a lista de categorias para o usuário escolher
      const allCategories = await Category.findAll({ order: [['type', 'ASC'], ['name', 'ASC']] });
      const options = allCategories.map(cat => ({
        id: `sel_cat_${cat.id}_exp_${pendingExpense.id}`, // sel_cat_{ID_CATEGORIA}_exp_{ID_DESPESA}
        title: cat.name,
        description: `Tipo: ${cat.type}`
      }));

      await whatsappService.sendOptionList(groupId, "Selecione a categoria correta para a despesa:", {
        title: "Lista de Categorias",
        buttonLabel: "Ver Categorias",
        options: options,
      });
    }
  }

  /**
   * Lida com a seleção de uma categoria da lista.
   */
  async handleListResponse(payload) {
    const optionId = payload.listResponseMessage.selectedRowId;
    const groupId = payload.phone;

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
      
      // Mover de pendente para confirmada
      await Expense.create({
        value: pendingExpense.value,
        description: pendingExpense.description,
        expense_date: pendingExpense.createdAt,
        whatsapp_message_id: pendingExpense.whatsapp_message_id,
        category_id: category.id, // USA O ID DA CATEGORIA ESCOLHIDA
      });

      // Deletar a pendência
      await pendingExpense.destroy();

      await whatsappService.sendWhatsappMessage(groupId, `✅ Categoria atualizada com sucesso para: *${category.name}*`);
      logger.info(`Despesa ${pendingExpenseId} confirmada com a categoria ${category.name} pelo usuário.`);
    }
  }
}

module.exports = new WebhookService();