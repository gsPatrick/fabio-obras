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
    
    // --- LÓGICA DE RECEBIMENTO DE MENSAGENS ---
    if (!payload.isGroup) return;

    const groupId = payload.phone;
    const isMonitored = await MonitoredGroup.findOne({ where: { group_id: groupId, is_active: true } });
    if (!isMonitored) return;

    logger.info(`[WebhookService] >>> Mensagem recebida no grupo monitorado: ${isMonitored.name}`);

    // --- NOVA LÓGICA: VERIFICAR SE É UMA RESPOSTA NUMÉRICA ---
    const textMessage = payload.text ? payload.text.message : null;
    if (textMessage && /^\d+$/.test(textMessage)) { // Verifica se a mensagem é apenas um número
      const handled = await this.handleNumericReply(groupId, parseInt(textMessage, 10));
      if (handled) return; // Se foi uma resposta de categoria, não faz mais nada
    }

    // --- LÓGICA PADRÃO DE ANÁLISE DE MÍDIA ---
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

  // ETAPA 1: Inicia o fluxo de validação (sem mudanças)
  async startValidationFlow(payload, analysisResult) {
    // ... (Esta função permanece a mesma)
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
    const message = `Análise concluída! 🤖\n\nDespesa de *${formattedValue}* foi sugerida para a categoria: *${category.name}*.\n\nSe estiver correto, não precisa fazer nada. Para corrigir, clique no botão abaixo.`;
    const buttons = [{ id: `edit_expense_${pendingExpense.id}`, label: '✏️ Editar Categoria' }];
    await whatsappService.sendButtonList(groupId, message, buttons);
    logger.info(`Fluxo de validação iniciado para a despesa pendente ID: ${pendingExpense.id}`);
  }

  // ETAPA 2: Usuário clica em "Editar". Enviamos a LISTA NUMERADA.
  async handleEditButton(payload) {
    const buttonId = payload.buttonsResponseMessage.buttonId;
    const groupId = payload.phone;
    if (buttonId && buttonId.startsWith('edit_expense_')) {
      const pendingExpenseId = buttonId.split('_')[2];
      const pendingExpense = await PendingExpense.findByPk(pendingExpenseId);
      if (!pendingExpense) {
        await whatsappService.sendWhatsappMessage(groupId, "Esta despesa não está mais pendente.");
        return;
      }
      
      const allCategories = await Category.findAll({ order: [['id', 'ASC']] });
      
      // Cria a mensagem de texto com a lista numerada
      const categoryListText = allCategories
        .map((cat, index) => `${index + 1} - ${cat.name}`)
        .join('\n');
      
      const message = `Ok! Para qual categoria você quer alterar?\n\n*Responda com o número correspondente:*\n\n${categoryListText}`;
      
      // Atualiza o status para indicar que estamos esperando um número
      pendingExpense.status = 'awaiting_category_reply';
      await pendingExpense.save();
      
      await whatsappService.sendWhatsappMessage(groupId, message);
      logger.info(`Enviada lista de categorias numeradas para a despesa pendente ID: ${pendingExpenseId}`);
    }
  }

  // ETAPA 3: Usuário responde com um número.
  async handleNumericReply(groupId, selectedNumber) {
    // Procura por UMA despesa que esteja esperando a resposta neste grupo
    const pendingExpense = await PendingExpense.findOne({
      where: {
        whatsapp_group_id: groupId,
        status: 'awaiting_category_reply',
      },
    });

    if (!pendingExpense) {
      return false; // Não era uma resposta de categoria, continua o fluxo normal.
    }

    const allCategories = await Category.findAll({ order: [['id', 'ASC']] });
    // O número - 1 corresponde ao índice do array (ex: número 1 é o índice 0)
    const selectedCategory = allCategories[selectedNumber - 1];

    if (!selectedCategory) {
      await whatsappService.sendWhatsappMessage(groupId, `O número "${selectedNumber}" não é uma opção válida. Por favor, tente novamente.`);
      return true; // A mensagem foi tratada (como um erro)
    }

    // Sucesso! Movemos a despesa para a tabela final.
    await Expense.create({
      value: pendingExpense.value,
      description: pendingExpense.description,
      expense_date: pendingExpense.createdAt,
      whatsapp_message_id: pendingExpense.whatsapp_message_id,
      category_id: selectedCategory.id, // USA O ID DA CATEGORIA ESCOLHIDA
    });

    await pendingExpense.destroy(); // Limpa a pendência

    await whatsappService.sendWhatsappMessage(groupId, `✅ Categoria atualizada com sucesso para: *${selectedCategory.name}*`);
    logger.info(`Despesa ${pendingExpense.id} confirmada com a categoria ${selectedCategory.name} via resposta numérica.`);
    
    return true; // A mensagem foi tratada com sucesso
  }
}

module.exports = new WebhookService();