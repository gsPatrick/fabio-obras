// src/features/WhatsappWebhook/whatsappWebhook.service.js
'use strict';

const logger = require('../../utils/logger');
// <<< MUDANÇA: Adicionar User e SubscriptionService >>>
const { MonitoredGroup, Category, PendingExpense, Expense, Profile, User } = require('../../models'); 
const subscriptionService = require('../../services/subscriptionService'); 
const { Op } = require('sequelize');
const aiService = require('../../utils/aiService');
const whatsappService = require('../../utils/whatsappService');
const dashboardService = require('../../features/Dashboard/dashboard.service');
const excelService = require('../../utils/excelService');
const fs = require('fs');
const path = require('path');
const { startOfMonth, format } = require('date-fns');
const ptBR = require('date-fns/locale/pt-BR');


// Tempo em minutos que o bot esperará pelo contexto (áudio/texto) após receber uma imagem.
const CONTEXT_WAIT_TIME_MINUTES = 2;
// Tempo em minutos para edição da categoria após o salvamento inicial
const EXPENSE_EDIT_WAIT_TIME_MINUTES = 1;

class WebhookService {
  async processIncomingMessage(payload) {
    // Lógica para IGNORAR APENAS o documento Excel enviado pelo PRÓPRIO BOT.
    if (payload.fromMe && payload.document && 
        payload.document.mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') {
      logger.debug('[Webhook] Ignorando documento Excel enviado pelo próprio bot.');
      return;
    }

    // Roteador de Ações: primeiro verifica cliques em botões.
    if (payload.buttonsResponseMessage) {
      return this.handleEditButton(payload);
    }
    
    // Ignora mensagens que não são de grupos.
    if (!payload.isGroup) {
      logger.debug('[Webhook] Ignorando mensagem que não é de grupo.');
      return;
    }

    // Ignora eventos sem um remetente identificado (ex: alguém entrou no grupo).
    const participantPhone = payload.participantPhone;
    if (!participantPhone) {
        logger.warn('[Webhook] Ignorando evento sem identificação do participante.');
        return;
    }

    // ===================================================================
    // <<< MUDANÇA CRÍTICA 1: Checar Monitoramento e o Dono do Perfil >>>
    // ===================================================================
    const monitoredGroup = await MonitoredGroup.findOne({ 
        where: { group_id: payload.phone, is_active: true },
        include: [{ 
            model: Profile, 
            as: 'profile',
            include: [{ model: User, as: 'user' }] // Incluir o Dono do Perfil
        }]
    });
    
    if (!monitoredGroup || !monitoredGroup.profile || !monitoredGroup.profile.user) {
      logger.debug(`[Webhook] Grupo ${payload.phone} não está sendo monitorado ou não tem perfil/usuário associado.`);
      return;
    }
    
    const ownerUserId = monitoredGroup.profile.user.id;
    
    // ===================================================================
    // <<< MUDANÇA CRÍTICA 2: Validação de Plano/Admin >>>
    // ===================================================================
    const isPlanActive = await subscriptionService.isUserActive(ownerUserId);

    if (!isPlanActive) {
      logger.warn(`[Webhook] Acesso negado. Usuário ${ownerUserId} (dono do perfil) não tem plano ativo. Ignorando mensagem do grupo ${payload.phone}.`);
      // Opcional: Enviar uma mensagem de "plano expirado" para o grupo.
      // await whatsappService.sendWhatsappMessage(payload.phone, "⚠️ *Acesso Bloqueado:* O plano de monitoramento expirou. Renove seu plano no Painel de Controle.");
      return;
    }
    // ===================================================================
    
    // Anexar o ID do Perfil para o restante do fluxo (continuação do código)
    payload.profileId = monitoredGroup.profile.id; 
    logger.debug(`[Webhook] Mensagem do grupo ${payload.phone} pertence ao Perfil ${payload.profileId} (Plano Ativo).`);
    
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
    const profileId = payload.profileId; // USAR profileId
    
    const mediaUrl = payload.image ? payload.image.imageUrl : payload.document.documentUrl;
    const mimeType = payload.image ? payload.image.mimeType : payload.document.mimeType;
    
    // Limpa pendências antigas do mesmo usuário para evitar confusão.
    await PendingExpense.destroy({
      where: {
        participant_phone: participantPhone,
        whatsapp_group_id: groupId,
        profile_id: profileId, // CRÍTICO: FILTRO POR PERFIL
        status: 'awaiting_context',
      }
    });

    await PendingExpense.create({
      whatsapp_message_id: payload.messageId,
      whatsapp_group_id: groupId,
      participant_phone: participantPhone,
      attachment_url: mediaUrl,
      attachment_mimetype: mimeType,
      status: 'awaiting_context',
      profile_id: profileId, // CRÍTICO: ADICIONAR profile_id
      expires_at: new Date(Date.now() + CONTEXT_WAIT_TIME_MINUTES * 60 * 1000),
    });

    const confirmationMessage = `📄 Qual a descrição para este documento?`;
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
    const profileId = payload.profileId; // USAR profileId
    const textMessage = payload.text ? payload.text.message : null;

    if (textMessage && textMessage.toLowerCase().trim() === '#relatorio') {
        logger.info(`[Webhook] Comando #Relatorio recebido de ${participantPhone}.`);
        await this.sendSpendingReport(groupId, participantPhone, profileId); // PASSAR profileId
        return;
    }

    if (textMessage && textMessage.toLowerCase().trim() === '#exportardespesas') {
        logger.info(`[Webhook] Comando #ExportarDespesas recebido de ${participantPhone}.`);
        await this.sendExpensesExcelReport(groupId, participantPhone, profileId); // PASSAR profileId
        return;
    }

    const pendingMedia = await PendingExpense.findOne({
      where: {
        participant_phone: participantPhone,
        whatsapp_group_id: groupId,
        profile_id: profileId, // CRÍTICO: FILTRO POR PERFIL
        status: 'awaiting_context',
        expires_at: { [Op.gt]: new Date() }
      },
      order: [['createdAt', 'DESC']]
    });

    if (pendingMedia) {
      // Verifica o mimetype antes de tentar análise de IA
      const allowedMimeTypesForAI = ['image/jpeg', 'image/png', 'application/pdf'];
      if (!allowedMimeTypesForAI.includes(pendingMedia.attachment_mimetype)) {
        logger.warn(`[Webhook] Mídia de tipo '${pendingMedia.attachment_mimetype}' não suportada para análise de IA. Ignorando.`);
        const fileExtension = path.extname(pendingMedia.attachment_url).substring(1);
        const errorMessage = `⚠️ O tipo de arquivo que você enviou (*.${fileExtension}*) não é suportado para análise de despesas com a IA. Por favor, envie uma imagem (JPEG/PNG) ou um PDF.`;
        await whatsappService.sendWhatsappMessage(groupId, errorMessage);
        await pendingMedia.destroy();
        return; // Interrompe o processamento
      }

      await whatsappService.sendWhatsappMessage(groupId, `🤖 Analisando...`);

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
        
        if (analysisResult) {
          return this.saveAndStartEditFlow(pendingMedia, analysisResult, userContext);
        } else {
          logger.error(`[Webhook] A análise da IA falhou para a mídia de ${participantPhone}.`);
          const errorMessage = `❌ Desculpe, não consegui analisar o documento. Por favor, tente enviar o documento e a descrição novamente.`;
          await whatsappService.sendWhatsappMessage(groupId, errorMessage);
          await pendingMedia.destroy();
        }

      } else {
          logger.error(`[Webhook] Falha ao baixar mídia ou transcrever áudio para ${participantPhone}.`);
          const errorMessage = `❌ Ocorreu um erro ao processar o arquivo ou o áudio. Por favor, tente novamente.`;
          await whatsappService.sendWhatsappMessage(groupId, errorMessage);
          await pendingMedia.destroy();
      }

    } else {
      if (textMessage && /^\d+$/.test(textMessage)) {
        await this.handleNumericReply(groupId, parseInt(textMessage, 10), participantPhone, profileId); // PASSAR profileId
      }
    }
  }

  /**
   * ETAPA 3: Salva a despesa no sistema e inicia o fluxo de edição de categoria.
   */
  async saveAndStartEditFlow(pendingExpense, analysisResult, userContext) {
    const { value, baseDescription, categoryName } = analysisResult;
    const finalDescriptionForDB = `${baseDescription} (${userContext})`;
    let category = await Category.findOne({ where: { name: categoryName } });
    
    if (!category || !category.id) {
        logger.warn(`[Webhook] Categoria '${categoryName}' sugerida pela IA não encontrada ou inválida. Usando 'Outros'.`);
        category = await Category.findOne({ where: { name: 'Outros' } });
        if (!category) {
            logger.error('[Webhook] Categoria "Outros" não encontrada. Falha crítica ao salvar despesa.');
            await whatsappService.sendWhatsappMessage(pendingExpense.whatsapp_group_id, `❌ Erro interno: Categoria padrão "Outros" não configurada.`);
            await pendingExpense.destroy();
            return;
        }
    }

    const newExpense = await Expense.create({
      value: value,
      description: finalDescriptionForDB,
      expense_date: pendingExpense.createdAt,
      whatsapp_message_id: pendingExpense.whatsapp_message_id,
      category_id: category.id,
      profile_id: pendingExpense.profile_id, // CRÍTICO: ADICIONAR profile_id
    });

    pendingExpense.value = value;
    pendingExpense.description = finalDescriptionForDB;
    pendingExpense.suggested_category_id = category.id;
    pendingExpense.expense_id = newExpense.id;
    pendingExpense.status = 'awaiting_validation'; // Significa "salvo, aguardando possível edição de categoria"
    pendingExpense.expires_at = new Date(Date.now() + EXPENSE_EDIT_WAIT_TIME_MINUTES * 60 * 1000); 
    await pendingExpense.save();
    
    const formattedValue = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);

    const totalExpenses = await Expense.sum('value', { where: { profile_id: pendingExpense.profile_id } }); // FILTRO POR PERFIL
    const formattedTotalExpenses = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(totalExpenses || 0);

    const message = `💸 *Custo Registrado:* ${formattedValue}
*Cat. Sugerida:* ${category.name}
*Desc.:* ${baseDescription}
*Total de Despesas:* ${formattedTotalExpenses}

Despesa *já* salva no sistema! Para alterar a categoria, clique *Corrigir*. Caso contrário, esta categoria será mantida em ${EXPENSE_EDIT_WAIT_TIME_MINUTES} min.`;

    const buttons = [{ id: `edit_expense_${pendingExpense.id}`, label: '✏️ Corrigir Categoria' }];
    await whatsappService.sendButtonList(pendingExpense.whatsapp_group_id, message, buttons);

    logger.info(`[Webhook] Despesa #${newExpense.id} salva e fluxo de edição iniciado para ${pendingExpense.participant_phone}.`);
  }

  /**
   * ETAPA 4: Usuário clica no botão "Corrigir".
   */
  async handleEditButton(payload) {
    const buttonId = payload.buttonsResponseMessage.buttonId;
    const groupId = payload.phone;
    const clickerPhone = payload.participantPhone;
    const profileId = payload.profileId; // USAR profileId

    if (buttonId && buttonId.startsWith('edit_expense_')) {
      const pendingExpenseId = buttonId.split('_')[2];
      const pendingExpense = await PendingExpense.findByPk(pendingExpenseId, {
          where: { profile_id: profileId }, // CRÍTICO: FILTRO POR PERFIL
          include: [{ model: Expense, as: 'expense' }]
      });
      
      if (!pendingExpense || !pendingExpense.expense) {
        const errorMessage = `⏳ *Tempo Esgotado* ⏳\n\nO prazo para editar esta despesa já expirou ou ela não existe.`;
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
      
      const formattedValue = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(pendingExpense.expense.value);
      const message = `📋 *Editar Categoria* \n\nVocê está editando a despesa *já salva* de *${formattedValue}* (${pendingExpense.expense.description}).\n\nResponda com o *número* da nova categoria: 👇\n\n${categoryListText}`;
      
      pendingExpense.status = 'awaiting_category_reply';
      pendingExpense.expires_at = new Date(Date.now() + EXPENSE_EDIT_WAIT_TIME_MINUTES * 60 * 1000); 
      await pendingExpense.save();
      
      await whatsappService.sendWhatsappMessage(groupId, message);
      logger.info(`[Webhook] Solicitação de edição de categoria para despesa #${pendingExpense.expense_id} por ${clickerPhone}.`);
    }
  }

  /**
   * ETAPA 5: Usuário responde com um número para finalizar a edição.
   */
  async handleNumericReply(groupId, selectedNumber, participantPhone, profileId) { // PASSAR profileId
    const pendingExpense = await PendingExpense.findOne({
      where: {
        whatsapp_group_id: groupId,
        participant_phone: participantPhone,
        profile_id: profileId, // CRÍTICO: FILTRO POR PERFIL
        status: 'awaiting_category_reply',
      },
      include: [{ model: Expense, as: 'expense' }]
    });

    if (!pendingExpense || !pendingExpense.expense) {
      logger.warn(`[Webhook] Resposta numérica de ${participantPhone} ignorada, pois não havia pendência de edição para ele.`);
      return false;
    }

    const allCategories = await Category.findAll({ order: [['id', 'ASC']] });
    const selectedCategory = allCategories[selectedNumber - 1];
    
    if (!selectedCategory) {
      const totalCategories = allCategories.length;
      const errorMessage = `⚠️ *Opção Inválida!* \n\nO número *${selectedNumber}* não está na lista. Responda com um número entre 1 e ${totalCategories}.`;
      await whatsappService.sendWhatsappMessage(groupId, errorMessage);
      return true;
    }

    await pendingExpense.expense.update({
        category_id: selectedCategory.id,
    });
    
    await pendingExpense.destroy();
    
    const totalExpenses = await Expense.sum('value', { where: { profile_id: profileId } }); // FILTRO POR PERFIL
    const formattedTotalExpenses = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(totalExpenses || 0);

    const successMessage = `✅ *Custo Atualizado!* 
Despesa #${pendingExpense.expense.id}
Nova categoria: *${selectedCategory.name}*
*Total de Despesas:* ${formattedTotalExpenses}`;
    await whatsappService.sendWhatsappMessage(groupId, successMessage);
    
    logger.info(`[Webhook] Despesa #${pendingExpense.expense_id} atualizada para categoria ${selectedCategory.name} por ${participantPhone}.`);
    return true;
  }

  async sendSpendingReport(groupId, recipientPhone, profileId) { // PASSAR profileId
    try {
        const now = new Date();
        const filters = {
            period: 'monthly',
        };

        const kpis = await dashboardService.getKPIs(filters, profileId); // PASSAR profileId
        const chartData = await dashboardService.getChartData(filters, profileId); // PASSAR profileId

        if (!kpis || !chartData) {
            await whatsappService.sendWhatsappMessage(groupId, `❌ Não foi possível gerar o relatório. Tente novamente mais tarde.`);
            return;
        }

        const formattedTotalExpenses = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(kpis.totalExpenses);
        
        let categorySummary = 'Sem gastos por categoria este mês.';
        if (chartData.pieChart && chartData.pieChart.length > 0) {
            categorySummary = chartData.pieChart
                .sort((a, b) => b.value - a.value)
                .map(cat => `- ${cat.name}: ${new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cat.value)}`)
                .join('\n');
        }

        const currentMonth = new Intl.DateTimeFormat('pt-BR', { month: 'long' }).format(now);
        const currentYear = now.getFullYear();
        const formattedReportHeaderMonth = `${currentMonth.charAt(0).toUpperCase() + currentMonth.slice(1)}/${currentYear}`;

        const reportMessage = `📊 *Relatório Mensal de Despesas* 📊
(${formattedReportHeaderMonth}) 

*Despesas Totais:* ${formattedTotalExpenses}

*Gastos por Categoria:*
${categorySummary}

_Este relatório é referente aos dados registrados até o momento._`;

        await whatsappService.sendWhatsappMessage(groupId, reportMessage);
        logger.info(`[Webhook] Relatório de gastos enviado para ${recipientPhone}.`);

    } catch (error) {
        logger.error('[Webhook] Erro ao gerar e enviar relatório de gastos:', error);
        await whatsappService.sendWhatsappMessage(groupId, `❌ Ocorreu um erro ao gerar seu relatório. Por favor, tente novamente.`);
    }
  }

  async sendExpensesExcelReport(groupId, recipientPhone, profileId) { // PASSAR profileId
    let filePath = null;
    try {
      const expenses = await dashboardService.getAllExpenses(profileId); // PASSAR profileId

      if (!expenses || expenses.length === 0) {
        await whatsappService.sendWhatsappMessage(groupId, `Nenhuma despesa encontrada para exportar.`);
        return;
      }

      filePath = await excelService.generateExpensesExcel(expenses);

      const caption = `Aqui está o seu relatório completo de despesas.`;
      await whatsappService.sendDocument(groupId, filePath, caption);
      
      logger.info(`[Webhook] Relatório Excel de despesas enviado para ${recipientPhone}.`);

    } catch (error) {
      logger.error('[Webhook] Erro ao gerar e enviar relatório Excel de despesas:', error);
      await whatsappService.sendWhatsappMessage(groupId, `❌ Ocorreu um erro ao gerar ou enviar seu relatório Excel. Por favor, tente novamente.`);
    } finally {
      if (filePath && fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        logger.info(`[Webhook] Arquivo temporário ${filePath} deletado.`);
      }
    }
  }
}

module.exports = new WebhookService();