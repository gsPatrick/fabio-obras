// src/features/WhatsappWebhook/whatsappWebhook.service.js
'use strict';

const logger = require('../../utils/logger');
const { MonitoredGroup, Category, PendingExpense, Expense, Profile, User, OnboardingState } = require('../../models');
const jwt = require('jsonwebtoken');
const subscriptionService = require('../../services/subscriptionService');
const profileService = require('../ProfileManager/profile.service');
const groupService = require('../GroupManager/group.service');
const categoryService = require('../CategoryManager/category.service');
const { Op } = require('sequelize');
const aiService = require('../../utils/aiService');
const whatsappService = require('../../utils/whatsappService');
const dashboardService = require('../../features/Dashboard/dashboard.service');
const excelService = require('../../utils/excelService');
const fs = require('fs');
const path = require('path');

const CONTEXT_WAIT_TIME_MINUTES = 2;
const EXPENSE_EDIT_WAIT_TIME_MINUTES = 5;
const ONBOARDING_WAIT_TIME_MINUTES = 10;

class WebhookService {

  async processIncomingMessage(payload) {
    if (payload.fromMe && payload.document && payload.document.mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') { return; }
    if (payload.notification === 'GROUP_CREATE') { return this.handleGroupJoin(payload); }
    if (!payload.isGroup) { return; }
    const onboardingState = await OnboardingState.findOne({ where: { group_id: payload.phone } });
    if (onboardingState) { return this.handleOnboardingResponse(payload, onboardingState); }
    if (payload.buttonsResponseMessage) { return this.handleButtonResponse(payload); }
    const participantPhone = payload.participantPhone;
    if (!participantPhone) { return; }
    const monitoredGroup = await MonitoredGroup.findOne({ where: { group_id: payload.phone, is_active: true }, include: [{ model: Profile, as: 'profile', include: [{ model: User, as: 'user' }] }] });
    if (!monitoredGroup || !monitoredGroup.profile || !monitoredGroup.profile.user) { logger.debug(`[Webhook] Grupo ${payload.phone} não está sendo monitorado ou não tem perfil/usuário associado.`); return; }
    const ownerUserId = monitoredGroup.profile.user.id;
    const isPlanActive = await subscriptionService.isUserActive(ownerUserId);
    if (!isPlanActive) { return; }
    payload.profileId = monitoredGroup.profile.id;
    if (payload.image || payload.document) { return this.handleMediaArrival(payload); }
    if (payload.audio || payload.text) { return this.handleContextArrival(payload); }
  }

  async handleGroupJoin(payload) {
    const groupId = payload.phone;
    const initiatorPhone = payload.connectedPhone;
    if (!initiatorPhone) { logger.error(`[Onboarding] Falha crítica: 'connectedPhone' não encontrado.`); return; }
    const user = await User.findOne({ where: { whatsapp_phone: initiatorPhone } });
    if (!user || user.status === 'pending') {
        if (user && user.status === 'pending') {
            await whatsappService.sendWhatsappMessage(groupId, "Olá! Parece que você já iniciou seu cadastro, mas ainda não o finalizou. Por favor, verifique o link que enviei anteriormente para definir sua senha.");
            return;
        }
        logger.warn(`[Onboarding] Novo usuário não registrado (${initiatorPhone}). Iniciando fluxo de pré-cadastro.`);
        await OnboardingState.destroy({ where: { group_id: groupId } });
        await OnboardingState.create({
            group_id: groupId,
            initiator_phone: initiatorPhone,
            status: 'awaiting_email',
            expires_at: new Date(Date.now() + ONBOARDING_WAIT_TIME_MINUTES * 60 * 1000),
        });
        const welcomeMessage = `Olá! 👋 Sou seu assistente de gestão de custos. Vi que você é novo por aqui!\n\nPara começarmos, por favor, me informe seu melhor e-mail para criarmos sua conta.`;
        await whatsappService.sendWhatsappMessage(groupId, welcomeMessage);
        return;
    }
    const isPlanActive = await subscriptionService.isUserActive(user.id);
    if (!isPlanActive) {
        const paymentMessage = `Olá! 👋 Para começar a monitorar os custos, sua conta precisa de uma assinatura ativa.\n\nPor favor, acesse nosso site para escolher seu plano:\nhttps://obras-fabio.vercel.app/landing#precos\n\nApós a confirmação, basta criar um novo grupo para iniciarmos a configuração.`;
        await whatsappService.sendWhatsappMessage(groupId, paymentMessage);
        return;
    }
    await OnboardingState.destroy({ where: { group_id: groupId } });
    await OnboardingState.create({
        group_id: groupId,
        initiator_phone: initiatorPhone,
        user_id: user.id,
        status: 'awaiting_profile_choice',
        expires_at: new Date(Date.now() + ONBOARDING_WAIT_TIME_MINUTES * 60 * 1000),
    });
    const welcomeMessage = `Olá! 👋 Sou seu novo assistente de gestão de custos.\n\nPara começar, precisamos vincular este grupo a um perfil de custos.\n\nO que você deseja fazer?`;
    const buttons = [ { id: 'onboarding_create_profile', label: '➕ Criar um novo Perfil' }, { id: 'onboarding_use_existing', label: '📂 Usar Perfil existente' } ];
    await whatsappService.sendButtonList(groupId, welcomeMessage, buttons);
    logger.info(`[Onboarding] Iniciei o processo de onboarding para o grupo ${groupId}, iniciado pelo usuário ${user.email}.`);
  }
  
  async handleOnboardingResponse(payload, state) {
    const groupId = payload.phone;
    const textMessage = payload.text ? payload.text.message : null;
    const buttonId = payload.buttonsResponseMessage ? payload.buttonsResponseMessage.buttonId : null;
    const selectedRowId = payload.listResponseMessage ? payload.listResponseMessage.selectedRowId : null;
    
    switch (state.status) {
      case 'awaiting_email':
        // <<< CORREÇÃO AQUI >>>
        // Só age se for uma mensagem de texto. Ignora callbacks e outras notificações.
        if (textMessage) { 
            if (textMessage.includes('@') && textMessage.includes('.')) { // Validação simples de e-mail
                const email = textMessage.trim();
                const existingUser = await User.findOne({ where: { email } });
                if (existingUser) {
                    await whatsappService.sendWhatsappMessage(groupId, `O e-mail ${email} já está cadastrado. Se você é o dono desta conta, por favor, adicione o número ${state.initiator_phone} ao seu perfil em nosso site e tente novamente.`);
                    await state.destroy();
                    return;
                }

                const newUser = await User.create({
                    email,
                    whatsapp_phone: state.initiator_phone,
                    status: 'pending',
                });
                
                const registrationToken = jwt.sign({ id: newUser.id }, process.env.JWT_SECRET || 'your-default-secret', { expiresIn: '1h' });
                const completionLink = `${process.env.FRONTEND_URL}/complete-registration?token=${registrationToken}`;

                const linkMessage = `✅ Ótimo! Criei um pré-cadastro para você com o e-mail: *${email}*\n\nAgora, o último passo:\n\n1️⃣ *Clique no link abaixo* para definir sua senha e ativar sua conta:\n${completionLink}\n\n2️⃣ Após ativar, você será direcionado para a página de planos.\n\n3️⃣ Assim que sua assinatura for confirmada, basta me *remover e adicionar novamente a este grupo* para começarmos a configuração do seu primeiro projeto!`;

                await whatsappService.sendWhatsappMessage(groupId, linkMessage);
                await state.destroy();
            } else {
                // Se for uma mensagem de texto, mas não um e-mail válido, pede novamente.
                await whatsappService.sendWhatsappMessage(groupId, "Isso não parece um e-mail válido. Por favor, tente novamente.");
            }
        }
        // Se não for uma mensagem de texto (textMessage é nulo), não faz nada e quebra o loop.
        break;

      case 'awaiting_profile_choice':
        const userId = state.user_id;
        if (buttonId === 'onboarding_create_profile') {
          state.status = 'awaiting_new_profile_name';
          await state.save();
          await whatsappService.sendWhatsappMessage(groupId, "Ótimo! Por favor, me diga o nome para este novo perfil (ex: Obra Apartamento 101).");
        } else if (buttonId === 'onboarding_use_existing') {
          const profiles = await profileService.getProfilesByUserId(userId);
          if (!profiles || profiles.length === 0) {
            await whatsappService.sendWhatsappMessage(groupId, "Você ainda não possui perfis. Vamos criar o primeiro! Qual será o nome dele?");
            state.status = 'awaiting_new_profile_name';
            await state.save();
          } else {
            const optionList = { title: "Seus Perfis", buttonLabel: "Escolha um Perfil", options: profiles.map(p => ({ id: `onboarding_select_profile_${p.id}`, title: p.name, description: `ID: ${p.id}` })) };
            await whatsappService.sendOptionList(groupId, "Selecione um de seus perfis para monitorar os custos deste grupo.", optionList);
          }
        } else if (selectedRowId && selectedRowId.startsWith('onboarding_select_profile_')) {
            const profileId = selectedRowId.split('_')[3];
            await groupService.startMonitoringGroup(groupId, profileId, userId);
            const profile = await Profile.findByPk(profileId);
            await whatsappService.sendWhatsappMessage(groupId, `✅ Perfil "${profile.name}" selecionado!`);
            await this.startCategoryCreationFlow(state, profileId);
        }
        break;

      case 'awaiting_new_profile_name':
        if (textMessage) {
          const newProfile = await profileService.createProfile({ name: textMessage, user_id: state.user_id });
          await groupService.startMonitoringGroup(groupId, newProfile.id, state.user_id);
          await whatsappService.sendWhatsappMessage(groupId, `✅ Perfil "${newProfile.name}" criado e vinculado a este grupo!`);
          await this.startCategoryCreationFlow(state, newProfile.id);
        }
        break;
      
      case 'awaiting_category_creation_start':
        if (buttonId === 'onboarding_add_category') {
            state.status = 'awaiting_new_category_name';
            await state.save();
            await whatsappService.sendWhatsappMessage(groupId, 'Qual o nome da nova categoria?');
        } else if (buttonId === 'onboarding_finish') {
            await whatsappService.sendWhatsappMessage(groupId, '👍 Configuração concluída! Já pode começar a registrar seus custos.');
            await state.destroy();
        }
        break;

      case 'awaiting_new_category_name':
          if (textMessage) {
              state.status = 'awaiting_new_category_type';
              state.temp_category_name = textMessage;
              await state.save();
              await whatsappService.sendWhatsappMessage(groupId, `Entendido. A qual tipo de custo a categoria "*${textMessage}*" pertence?\n\nResponda com uma das opções: *Material*, *Mão de Obra*, *Serviços/Equipamentos* ou *Outros*.`);
          }
          break;

      case 'awaiting_new_category_type':
          if (textMessage) {
              const validTypes = ['Material', 'Mão de Obra', 'Serviços/Equipamentos', 'Outros'];
              const normalizedType = validTypes.find(t => t.toLowerCase() === textMessage.trim().toLowerCase());
              if (!normalizedType) {
                  await whatsappService.sendWhatsappMessage(groupId, `⚠️ Tipo inválido. Por favor, responda com uma das opções: *Material*, *Mão de Obra*, *Serviços/Equipamentos* ou *Outros*.`);
              } else {
                  await categoryService.create({ name: state.temp_category_name, type: normalizedType }, state.profile_id);
                  await whatsappService.sendWhatsappMessage(groupId, `✅ Categoria "*${state.temp_category_name}*" criada com sucesso!`);
                  await this.startCategoryCreationFlow(state, state.profile_id, false);
              }
          }
          break;
    }
  }

  async startCategoryCreationFlow(state, profileId, isFirstTime = true) {
    state.status = 'awaiting_category_creation_start';
    state.profile_id = profileId;
    state.temp_category_name = null;
    await state.save();
    
    const message = isFirstTime
      ? 'Agora, vamos configurar suas categorias de custo. Você pode criar quantas quiser.'
      : 'Deseja adicionar outra categoria?';
      
    const buttons = [
        { id: 'onboarding_add_category', label: '➕ Adicionar Categoria' },
        { id: 'onboarding_finish', label: '🏁 Finalizar Configuração' }
    ];
    await whatsappService.sendButtonList(state.group_id, message, buttons);
  }

  async handleButtonResponse(payload) {
    const buttonId = payload.buttonsResponseMessage.buttonId;
    if (buttonId.startsWith('edit_expense_')) {
      return this.handleEditButtonFlow(payload);
    }
    if (buttonId.startsWith('new_cat_')) {
      return this.handleNewCategoryDecisionFlow(payload);
    }
  }

  async handleMediaArrival(payload) {
    const groupId = payload.phone;
    const participantPhone = payload.participantPhone;
    const profileId = payload.profileId;
    const mediaUrl = payload.image ? payload.image.imageUrl : payload.document.documentUrl;
    const mimeType = payload.image ? payload.image.mimeType : payload.document.mimeType;
    await PendingExpense.destroy({ where: { participant_phone: participantPhone, whatsapp_group_id: groupId, profile_id: profileId, status: 'awaiting_context' } });
    await PendingExpense.create({
      whatsapp_message_id: payload.messageId,
      whatsapp_group_id: groupId,
      participant_phone: participantPhone,
      attachment_url: mediaUrl,
      attachment_mimetype: mimeType,
      status: 'awaiting_context',
      profile_id: profileId,
      expires_at: new Date(Date.now() + CONTEXT_WAIT_TIME_MINUTES * 60 * 1000),
    });
    const confirmationMessage = `📄 Qual a descrição para este documento?`;
    await whatsappService.sendWhatsappMessage(groupId, confirmationMessage);
    logger.info(`[Webhook] Mídia (${mimeType}) de ${participantPhone} recebida. Mensagem de confirmação enviada.`);
  }

  async handleContextArrival(payload) {
    const groupId = payload.phone;
    const participantPhone = payload.participantPhone;
    const profileId = payload.profileId;
    const textMessage = payload.text ? payload.text.message : null;

    const pendingCategoryType = await PendingExpense.findOne({
      where: { participant_phone: participantPhone, whatsapp_group_id: groupId, profile_id: profileId, status: 'awaiting_new_category_type' }
    });
    if (pendingCategoryType && textMessage) {
      return this.finalizeNewCategoryCreation(pendingCategoryType, textMessage);
    }

    if (textMessage && textMessage.toLowerCase().trim() === '#relatorio') {
        return this.sendSpendingReport(groupId, participantPhone, profileId);
    }
    if (textMessage && textMessage.toLowerCase().trim() === '#exportardespesas') {
        return this.sendExpensesExcelReport(groupId, participantPhone, profileId);
    }

    const pendingMedia = await PendingExpense.findOne({
      where: { participant_phone: participantPhone, whatsapp_group_id: groupId, profile_id: profileId, status: 'awaiting_context', expires_at: { [Op.gt]: new Date() } },
      order: [['createdAt', 'DESC']]
    });

    if (pendingMedia) {
      const allowedMimeTypesForAI = ['image/jpeg', 'image/png', 'application/pdf'];
      if (!allowedMimeTypesForAI.includes(pendingMedia.attachment_mimetype)) {
        const fileExtension = path.extname(pendingMedia.attachment_url).substring(1);
        const errorMessage = `⚠️ O tipo de arquivo que você enviou (*.${fileExtension}*) não é suportado para análise. Por favor, envie uma imagem (JPEG/PNG) ou um PDF.`;
        await whatsappService.sendWhatsappMessage(groupId, errorMessage);
        await pendingMedia.destroy();
        return;
      }

      await whatsappService.sendWhatsappMessage(groupId, `🤖 Analisando...`);
      let userContext = '';
      if (payload.audio) {
        const audioBuffer = await whatsappService.downloadZapiMedia(payload.audio.audioUrl);
        userContext = audioBuffer ? await aiService.transcribeAudio(audioBuffer) : '';
      } else {
        userContext = payload.text.message;
      }
      
      const mediaBuffer = await whatsappService.downloadZapiMedia(pendingMedia.attachment_url);
      if (mediaBuffer && userContext) {
        const analysisResult = await aiService.analyzeExpenseWithImage(mediaBuffer, userContext, pendingMedia.attachment_mimetype, pendingMedia.profile_id);
        if (analysisResult) {
          return this.decideAndSaveExpense(pendingMedia, analysisResult, userContext);
        } else {
          await whatsappService.sendWhatsappMessage(groupId, `❌ Desculpe, não consegui analisar o documento. Tente enviar novamente.`);
          await pendingMedia.destroy();
        }
      } else {
        await whatsappService.sendWhatsappMessage(groupId, `❌ Ocorreu um erro ao processar o arquivo ou o áudio. Por favor, tente novamente.`);
        await pendingMedia.destroy();
      }
    } else {
      if (textMessage && /^\d+$/.test(textMessage)) {
        await this.handleNumericReply(groupId, parseInt(textMessage, 10), participantPhone, profileId);
      }
    }
  }

  async decideAndSaveExpense(pendingExpense, analysisResult, userContext) {
    const { categoryName } = analysisResult;
    const profileId = pendingExpense.profile_id;
    
    const category = await Category.findOne({ where: { name: categoryName, profile_id: profileId } });

    if (category) {
      return this.createExpenseAndStartEditFlow(pendingExpense, analysisResult, userContext, category.id);
    }

    const finalDescriptionForDB = `${analysisResult.baseDescription} (${userContext})`;
    pendingExpense.value = analysisResult.value;
    pendingExpense.description = finalDescriptionForDB;
    pendingExpense.status = 'awaiting_new_category_decision';
    pendingExpense.suggested_new_category_name = categoryName;
    pendingExpense.expires_at = new Date(Date.now() + EXPENSE_EDIT_WAIT_TIME_MINUTES * 60 * 1000);
    await pendingExpense.save();

    const message = `🤔 A categoria que identifiquei, "*${categoryName}*", parece ser nova para este perfil. O que você gostaria de fazer?`;
    const buttons = [
        { id: `new_cat_create_${pendingExpense.id}`, label: '✅ Criar e Usar' },
        { id: `new_cat_choose_${pendingExpense.id}`, label: '📋 Escolher da Lista' },
        { id: `new_cat_outros_${pendingExpense.id}`, label: '➡️ Usar "Outros"' },
    ];
    await whatsappService.sendButtonList(pendingExpense.whatsapp_group_id, message, buttons);
    logger.info(`[Webhook] Nova categoria "${categoryName}" sugerida. Aguardando decisão do usuário para pendência #${pendingExpense.id}.`);
  }

  async createExpenseAndStartEditFlow(pendingExpense, analysisResult, userContext, categoryId) {
    const { value, baseDescription } = analysisResult;
    const finalDescriptionForDB = userContext ? `${baseDescription} (${userContext})` : baseDescription;
    
    const category = await Category.findByPk(categoryId);
    const newExpense = await Expense.create({
      value,
      description: finalDescriptionForDB,
      expense_date: pendingExpense.createdAt,
      whatsapp_message_id: pendingExpense.whatsapp_message_id,
      category_id: categoryId,
      profile_id: pendingExpense.profile_id,
    });

    if (pendingExpense.status === 'awaiting_context') {
      pendingExpense.value = value;
      pendingExpense.description = finalDescriptionForDB;
      pendingExpense.suggested_category_id = categoryId;
    }
    pendingExpense.expense_id = newExpense.id;
    pendingExpense.status = 'awaiting_validation';
    pendingExpense.expires_at = new Date(Date.now() + EXPENSE_EDIT_WAIT_TIME_MINUTES * 60 * 1000); 
    await pendingExpense.save();
    
    const formattedValue = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
    const totalExpenses = await Expense.sum('value', { where: { profile_id: pendingExpense.profile_id } });
    const formattedTotalExpenses = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(totalExpenses || 0);

    const message = `💸 *Custo Registrado:* ${formattedValue}\n*Categoria:* ${category.name}\n*Desc.:* ${baseDescription}\n*Total de Despesas:* ${formattedTotalExpenses}\n\nDespesa *já* salva! Para alterar a categoria, clique em *Corrigir*.`;
    const buttons = [{ id: `edit_expense_${pendingExpense.id}`, label: '✏️ Corrigir Categoria' }];
    await whatsappService.sendButtonList(pendingExpense.whatsapp_group_id, message, buttons);
    logger.info(`[Webhook] Despesa #${newExpense.id} salva e fluxo de edição iniciado para ${pendingExpense.participant_phone}.`);
  }

  async handleNewCategoryDecisionFlow(payload) {
    const buttonId = payload.buttonsResponseMessage.buttonId;
    const parts = buttonId.split('_');
    const action = parts[2];
    const pendingExpenseId = parts[3];
    const groupId = payload.phone;
    const profileId = payload.profileId;

    const pendingExpense = await PendingExpense.findByPk(pendingExpenseId, { where: { profile_id: profileId } });
    if (!pendingExpense) {
      await whatsappService.sendWhatsappMessage(groupId, `⏳ O tempo para esta decisão expirou.`);
      return;
    }

    if (action === 'create') {
        pendingExpense.status = 'awaiting_new_category_type';
        await pendingExpense.save();
        await whatsappService.sendWhatsappMessage(groupId, `Entendido! A qual tipo de custo a categoria "*${pendingExpense.suggested_new_category_name}*" pertence?\n\nResponda com uma das opções: *Material*, *Mão de Obra*, *Serviços/Equipamentos* ou *Outros*.`);
    } else if (action === 'choose') {
        payload.buttonsResponseMessage.buttonId = `edit_expense_${pendingExpenseId}`;
        await this.handleEditButtonFlow(payload);
    } else if (action === 'outros') {
        const outrosCategory = await Category.findOne({ where: { name: 'Outros', profile_id: profileId } });
        if (!outrosCategory) {
          await whatsappService.sendWhatsappMessage(groupId, `❌ Erro crítico: A categoria "Outros" não foi encontrada para este perfil.`);
          return;
        }
        const analysisResult = { value: pendingExpense.value, baseDescription: pendingExpense.description.split(' (')[0] };
        const userContext = pendingExpense.description.match(/\(([^)]+)\)/)?.[1] || '';
        await this.createExpenseAndStartEditFlow(pendingExpense, analysisResult, userContext, outrosCategory.id);
    }
  }

  async finalizeNewCategoryCreation(pendingExpense, categoryType) {
    const validTypes = ['Material', 'Mão de Obra', 'Serviços/Equipamentos', 'Outros'];
    const normalizedType = validTypes.find(t => t.toLowerCase() === categoryType.trim().toLowerCase());

    if (!normalizedType) {
      await whatsappService.sendWhatsappMessage(pendingExpense.whatsapp_group_id, `⚠️ Tipo inválido. Por favor, responda com uma das opções: *Material*, *Mão de Obra*, *Serviços/Equipamentos* ou *Outros*.`);
      return;
    }
    
    const newCategory = await categoryService.create({
      name: pendingExpense.suggested_new_category_name,
      type: normalizedType,
    }, pendingExpense.profile_id);

    const newExpense = await Expense.create({
      value: pendingExpense.value,
      description: pendingExpense.description,
      expense_date: pendingExpense.createdAt,
      whatsapp_message_id: pendingExpense.whatsapp_message_id,
      category_id: newCategory.id,
      profile_id: pendingExpense.profile_id,
    });
    
    await pendingExpense.destroy();

    const formattedValue = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(newExpense.value);
    const totalExpenses = await Expense.sum('value', { where: { profile_id: newExpense.profile_id } });
    const formattedTotalExpenses = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(totalExpenses || 0);

    const message = `✅ *Custo Registrado com Sucesso!*\n\n💸 *Valor:* ${formattedValue}\n*Nova Categoria:* ${newCategory.name}\n*Total de Despesas:* ${formattedTotalExpenses}`;
    await whatsappService.sendWhatsappMessage(pendingExpense.whatsapp_group_id, message);
    logger.info(`[Webhook] Nova categoria "${newCategory.name}" criada e despesa #${newExpense.id} registrada.`);
  }

  async handleEditButtonFlow(payload) {
      const buttonId = payload.buttonsResponseMessage.buttonId;
      const groupId = payload.phone;
      const clickerPhone = payload.participantPhone;
      const profileId = payload.profileId;
      
      const pendingExpenseId = buttonId.split('_')[2];
      const pendingExpense = await PendingExpense.findByPk(pendingExpenseId, { where: { profile_id: profileId }});
      
      if (!pendingExpense) {
        await whatsappService.sendWhatsappMessage(groupId, `⏳ *Tempo Esgotado* ⏳\n\nO prazo para editar esta despesa já expirou ou ela não existe.`);
        return;
      }
      
      if (pendingExpense.participant_phone !== clickerPhone) {
        await whatsappService.sendWhatsappMessage(groupId, `🤚 *Atenção, ${clickerPhone}!* \n\nApenas a pessoa que registrou a despesa (${pendingExpense.participant_phone}) pode editá-la.`);
        return;
      }

      const allCategories = await Category.findAll({ where: { profile_id: profileId }, order: [['name', 'ASC']] });
      const categoryListText = allCategories.map((cat, index) => `${index + 1} - ${cat.name}`).join('\n');
      
      const valueToFormat = pendingExpense.expense ? pendingExpense.expense.value : pendingExpense.value;
      const descriptionToUse = pendingExpense.expense ? pendingExpense.expense.description : pendingExpense.description;
      const formattedValue = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(valueToFormat);
      
      const message = `📋 *Escolha a Categoria Correta*\n\nVocê está definindo a categoria para a despesa de *${formattedValue}* (${descriptionToUse}).\n\nResponda com o *número* da nova categoria: 👇\n\n${categoryListText}`;
      
      pendingExpense.status = 'awaiting_category_reply';
      pendingExpense.expires_at = new Date(Date.now() + EXPENSE_EDIT_WAIT_TIME_MINUTES * 60 * 1000); 
      await pendingExpense.save();
      
      await whatsappService.sendWhatsappMessage(groupId, message);
      logger.info(`[Webhook] Solicitação de escolha de categoria para pendência #${pendingExpense.id} por ${clickerPhone}.`);
  }

  async handleNumericReply(groupId, selectedNumber, participantPhone, profileId) {
    const pendingExpense = await PendingExpense.findOne({
      where: { whatsapp_group_id: groupId, participant_phone: participantPhone, profile_id: profileId, status: 'awaiting_category_reply' },
      include: [{ model: Expense, as: 'expense' }]
    });

    if (!pendingExpense) {
      logger.warn(`[Webhook] Resposta numérica de ${participantPhone} ignorada, pois não havia pendência de edição para ele.`);
      return false;
    }

    const allCategories = await Category.findAll({ where: { profile_id: profileId }, order: [['name', 'ASC']] });
    const selectedCategory = allCategories[selectedNumber - 1];
    
    if (!selectedCategory) {
      const totalCategories = allCategories.length;
      await whatsappService.sendWhatsappMessage(groupId, `⚠️ *Opção Inválida!* \n\nO número *${selectedNumber}* não está na lista. Responda com um número entre 1 e ${totalCategories}.`);
      return true;
    }

    if (pendingExpense.expense) {
      await pendingExpense.expense.update({ category_id: selectedCategory.id });
    } else {
      const analysisResult = { value: pendingExpense.value, baseDescription: pendingExpense.description.split(' (')[0] };
      const userContext = pendingExpense.description.match(/\(([^)]+)\)/)?.[1] || '';
      await this.createExpenseAndStartEditFlow(pendingExpense, analysisResult, userContext, selectedCategory.id);
      return true;
    }
    
    await pendingExpense.destroy();
    
    const totalExpenses = await Expense.sum('value', { where: { profile_id: profileId } });
    const formattedTotalExpenses = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(totalExpenses || 0);

    const successMessage = `✅ *Custo Atualizado!* \nDespesa #${pendingExpense.expense.id}\nNova categoria: *${selectedCategory.name}*\n*Total de Despesas:* ${formattedTotalExpenses}`;
    await whatsappService.sendWhatsappMessage(groupId, successMessage);
    logger.info(`[Webhook] Despesa #${pendingExpense.expense_id} atualizada para categoria ${selectedCategory.name} por ${participantPhone}.`);
    return true;
  }

  async sendSpendingReport(groupId, recipientPhone, profileId) {
      try {
          const now = new Date();
          const filters = { period: 'monthly' };
          const kpis = await dashboardService.getKPIs(filters, profileId);
          const chartData = await dashboardService.getChartData(filters, profileId);
          if (!kpis || !chartData) { await whatsappService.sendWhatsappMessage(groupId, `❌ Não foi possível gerar o relatório.`); return; }
          const formattedTotalExpenses = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(kpis.totalExpenses);
          let categorySummary = 'Sem gastos por categoria este mês.';
          if (chartData.pieChart && chartData.pieChart.length > 0) {
              categorySummary = chartData.pieChart.sort((a, b) => b.value - a.value).map(cat => `- ${cat.name}: ${new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cat.value)}`).join('\n');
          }
          const currentMonth = new Intl.DateTimeFormat('pt-BR', { month: 'long' }).format(now);
          const currentYear = new Date().getFullYear();
          const formattedReportHeaderMonth = `${currentMonth.charAt(0).toUpperCase() + currentMonth.slice(1)}/${currentYear}`;
          const reportMessage = `📊 *Relatório Mensal de Despesas* 📊\n(${formattedReportHeaderMonth}) \n\n*Despesas Totais:* ${formattedTotalExpenses}\n\n*Gastos por Categoria:*\n${categorySummary}\n\n_Este relatório é referente aos dados registrados até o momento._`;
          await whatsappService.sendWhatsappMessage(groupId, reportMessage);
      } catch (error) {
          logger.error('[Webhook] Erro ao gerar e enviar relatório de gastos:', error);
          await whatsappService.sendWhatsappMessage(groupId, `❌ Ocorreu um erro ao gerar seu relatório.`);
      }
  }

  async sendExpensesExcelReport(groupId, recipientPhone, profileId) {
      let filePath = null;
      try {
        const expenses = await dashboardService.getAllExpenses(profileId);
        if (!expenses || expenses.length === 0) { await whatsappService.sendWhatsappMessage(groupId, `Nenhuma despesa encontrada para exportar.`); return; }
        filePath = await excelService.generateExpensesExcel(expenses);
        await whatsappService.sendDocument(groupId, filePath, `Aqui está o seu relatório completo de despesas.`);
      } catch (error) {
        logger.error('[Webhook] Erro ao gerar e enviar relatório Excel de despesas:', error);
        await whatsappService.sendWhatsappMessage(groupId, `❌ Ocorreu um erro ao gerar ou enviar seu relatório Excel.`);
      } finally {
        if (filePath && fs.existsSync(filePath)) { fs.unlinkSync(filePath); }
      }
  }
}

module.exports = new WebhookService();