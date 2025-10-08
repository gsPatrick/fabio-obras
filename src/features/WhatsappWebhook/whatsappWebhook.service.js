// src/features/WhatsappWebhook/whatsappWebhook.service.js
'use strict';

const logger = require('../../utils/logger');
const { MonitoredGroup, Category, PendingExpense, Expense, Profile, User, OnboardingState } = require('../../models');
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

  async _findUserByFlexiblePhone(phone) {
    if (!phone) return null;
    const variations = new Set([phone]);
    if (phone.startsWith('55') && phone.length === 12) {
      const areaCode = phone.substring(2, 4);
      const localNumber = phone.substring(4);
      if (localNumber.length === 8) {
        variations.add(`55${areaCode}9${localNumber}`);
      }
    } else if (phone.startsWith('55') && phone.length === 13) {
      const areaCode = phone.substring(2, 4);
      const localNumber = phone.substring(4);
      if (localNumber.startsWith('9') && localNumber.length === 9) {
        variations.add(`55${areaCode}${localNumber.substring(1)}`);
      }
    }
    logger.info(`[Auth] Buscando usuário com variações de telefone: ${Array.from(variations).join(', ')}`);
    return User.findOne({ where: { whatsapp_phone: { [Op.in]: Array.from(variations) } } });
  }

  async processIncomingMessage(payload) {
    if (payload.fromMe) { return; }
    if (payload.notification === 'GROUP_CREATE') { return this.handleGroupJoin(payload); }
    if (!payload.isGroup) { return; }

    const onboardingState = await OnboardingState.findOne({ where: { group_id: payload.phone } });
    if (onboardingState) { return this.handleOnboardingResponse(payload, onboardingState); }

    const participantPhone = payload.participantPhone;
    if (!participantPhone) { return; }

    const monitoredGroup = await MonitoredGroup.findOne({ where: { group_id: payload.phone, is_active: true } });
    if (!monitoredGroup) {
        const user = await this._findUserByFlexiblePhone(participantPhone);
        if (user && user.status === 'pending') {
            logger.info(`[Webhook] Mensagem de usuário pendente (${user.email}) em grupo não monitorado.`);
            await this.startPendingPaymentFlow(payload.phone, participantPhone, user);
            return;
        }
        logger.debug(`[Webhook] Grupo ${payload.phone} não está sendo monitorado ou participante não está pendente.`);
        return;
    }

    if (payload.buttonsResponseMessage) { return this.handleButtonResponse(payload); }

    const groupWithDetails = await MonitoredGroup.findOne({ where: { id: monitoredGroup.id }, include: [{ model: Profile, as: 'profile', include: [{ model: User, as: 'user' }] }] });
    if (!groupWithDetails.profile || !groupWithDetails.profile.user) { logger.error(`[Webhook] Falha crítica: Grupo monitorado ${monitoredGroup.id} não possui perfil ou usuário associado.`); return; }

    const ownerUserId = groupWithDetails.profile.user.id;
    const isPlanActive = await subscriptionService.isUserActive(ownerUserId);
    if (!isPlanActive) {
      logger.warn(`[Webhook] Acesso negado para ${groupWithDetails.profile.user.email}. Plano inativo.`);
      const checkout = await subscriptionService.createSubscriptionCheckout(ownerUserId);
      const paymentMessage = `Sua assinatura não está ativa. Para continuar registrando despesas, por favor, renove seu plano através do link abaixo:\n\n${checkout.checkoutUrl}`;
      await whatsappService.sendWhatsappMessage(payload.phone, paymentMessage);
      return;
    }

    payload.profileId = groupWithDetails.profile.id;
    if (payload.image || payload.document) { return this.handleMediaArrival(payload); }
    if (payload.audio || payload.text) { return this.handleContextArrival(payload); }
  }
  
  async handleGroupJoin(payload) {
    const groupId = payload.phone;
    logger.info(`[Onboarding] Bot adicionado ao grupo ${groupId}. Verificando participantes...`);
  
    const metadata = await whatsappService.getGroupMetadata(groupId);
    if (!metadata || !metadata.participants) {
      logger.error(`[Onboarding] Falha ao obter metadados para o grupo ${groupId}. Abortando.`);
      return;
    }

    logger.info('[Onboarding] Metadados recebidos:', JSON.stringify(metadata, null, 2));
  
    let responsibleUser = null;
    let initiatorPhone = null;

    for (const participant of metadata.participants) {
      if (!participant.phone) continue;
      const user = await this._findUserByFlexiblePhone(participant.phone);
      if (user) {
        const isPlanActive = await subscriptionService.isUserActive(user.id);
        if (isPlanActive) {
          responsibleUser = user;
          initiatorPhone = participant.phone;
          logger.info(`[Onboarding] Usuário prioritário (Admin/Ativo) encontrado: ${user.email}.`);
          break;
        }
      }
    }
  
    if (responsibleUser) {
      logger.info(`[Onboarding] Iniciando fluxo de configuração de perfil para ${responsibleUser.email}.`);
      await OnboardingState.destroy({ where: { group_id: groupId } });
      await OnboardingState.create({
        group_id: groupId,
        initiator_phone: initiatorPhone,
        user_id: responsibleUser.id,
        status: 'awaiting_profile_choice',
        expires_at: new Date(Date.now() + ONBOARDING_WAIT_TIME_MINUTES * 60 * 1000),
      });
      const welcomeMessage = `Olá! 👋 Sou seu novo assistente de gestão de custos.\n\nNotei que você, um usuário com plano ativo, está neste grupo. Para começar, vamos vincular este grupo a um perfil de custos.\n\nO que você deseja fazer?`;
      const buttons = [ { id: 'onboarding_create_profile', label: '➕ Criar um novo Perfil' }, { id: 'onboarding_use_existing', label: '📂 Usar Perfil existente' } ];
      await whatsappService.sendButtonList(groupId, welcomeMessage, buttons);
      return;
    }
  
    const ownerParticipant = metadata.participants.find(p => p.isSuperAdmin);
    
    if (!ownerParticipant || !ownerParticipant.phone) {
      logger.error(`[Onboarding] Não foi possível identificar o participante dono (isSuperAdmin) com um número de telefone válido no grupo ${groupId}. Abortando.`);
      return;
    }

    const ownerPhone = ownerParticipant.phone;
    logger.info(`[Onboarding] Dono do grupo identificado pelo número real: ${ownerPhone}`);
  
    const ownerUser = await this._findUserByFlexiblePhone(ownerPhone);
  
    if (ownerUser) {
      if (ownerUser.status === 'pending') {
        logger.warn(`[Onboarding] O dono do grupo (${ownerUser.email}) tem um cadastro pendente de pagamento.`);
        await this.startPendingPaymentFlow(groupId, ownerPhone, ownerUser);
      } else {
        logger.warn(`[Onboarding] O dono do grupo (${ownerUser.email}) tem um plano inativo/expirado.`);
        const checkout = await subscriptionService.createSubscriptionCheckout(ownerUser.id);
        const paymentMessage = `Olá! 👋 Para começar a monitorar os custos neste grupo, sua conta precisa de uma assinatura ativa.\n\nClique no link abaixo para reativar seu plano:\n\n${checkout.checkoutUrl}\n\nApós a confirmação, basta me remover e adicionar novamente a este grupo para iniciarmos a configuração.`;
        await whatsappService.sendWhatsappMessage(groupId, paymentMessage);
      }
    } else {
      logger.warn(`[Onboarding] Dono do grupo (${ownerPhone}) não encontrado em nosso sistema. Iniciando fluxo de novo cadastro.`);
      await OnboardingState.create({
        group_id: groupId,
        initiator_phone: ownerPhone,
        status: 'awaiting_email',
        expires_at: new Date(Date.now() + ONBOARDING_WAIT_TIME_MINUTES * 60 * 1000),
      });
      const welcomeMessage = `Olá! 👋 Sou seu assistente de gestão de custos. Vi que você é novo por aqui!\n\nPara começarmos, por favor, me informe seu melhor e-mail para criarmos sua conta.`;
      await whatsappService.sendWhatsappMessage(groupId, welcomeMessage);
    }
  }

  async startPendingPaymentFlow(groupId, initiatorPhone, user) {
      await OnboardingState.destroy({ where: { group_id: groupId } });
      await OnboardingState.create({
          group_id: groupId,
          initiator_phone: initiatorPhone,
          user_id: user.id,
          status: 'awaiting_pending_payment',
          expires_at: new Date(Date.now() + ONBOARDING_WAIT_TIME_MINUTES * 60 * 1000),
      });
      const message = `Olá! 👋 Vi que seu cadastro para o e-mail *${user.email}* ainda está pendente de pagamento.\n\nPara ativar sua conta, por favor, finalize a assinatura.`;
      const buttons = [{ id: `pending_generate_link_${user.id}`, label: '💳 Gerar novo link de pagamento' }];
      await whatsappService.sendButtonList(groupId, message, buttons);
  }

  async handleOnboardingResponse(payload, state) {
    if (payload.fromMe) { return; }
    const groupId = payload.phone;
    const textMessage = payload.text ? payload.text.message : null;
    const buttonId = payload.buttonsResponseMessage ? payload.buttonsResponseMessage.buttonId : null;
    
    const userIsInitiator = await this._findUserByFlexiblePhone(payload.participantPhone);
    if (!userIsInitiator || userIsInitiator.id !== state.user_id) {
        if (!state.user_id && payload.participantPhone !== state.initiator_phone) {
            logger.warn(`[Onboarding] Resposta ignorada. Participante ${payload.participantPhone} não é o iniciador ${state.initiator_phone}.`);
            return;
        }
    }
    
    switch (state.status) {
      case 'awaiting_pending_payment':
          if (buttonId && buttonId.startsWith('pending_generate_link_')) {
              const userId = buttonId.split('_')[3];
              const checkout = await subscriptionService.createSubscriptionCheckout(userId);
              const linkMessage = `Aqui está seu novo link para pagamento:\n\n${checkout.checkoutUrl}\n\nApós a confirmação, remova-me e adicione-me novamente ao grupo para começar!`;
              await whatsappService.sendWhatsappMessage(groupId, linkMessage);
              await state.destroy();
          }
          break;

      case 'awaiting_email':
        if (textMessage) { 
            if (textMessage.includes('@') && textMessage.includes('.')) {
                const email = textMessage.trim();
                const existingUser = await User.findOne({ where: { email } });
                if (existingUser) {
                    await whatsappService.sendWhatsappMessage(groupId, `O e-mail ${email} já está cadastrado. Se você é o dono desta conta, por favor, adicione o número ${state.initiator_phone} ao seu perfil em nosso site e tente novamente.`);
                    await state.destroy();
                    return;
                }
                state.status = 'awaiting_password';
                state.temp_user_email = email;
                await state.save();
                await whatsappService.sendWhatsappMessage(groupId, `✅ E-mail recebido! Agora, por favor, crie uma *senha* para sua conta (mínimo de 6 caracteres).`);
            } else {
                await whatsappService.sendWhatsappMessage(groupId, "Isso não parece um e-mail válido. Por favor, tente novamente.");
            }
        }
        break;

      case 'awaiting_password':
        if (textMessage) {
            const password = textMessage.trim();
            const email = state.temp_user_email;

            if (password.length < 6) {
                await whatsappService.sendWhatsappMessage(groupId, "Senha muito curta. Por favor, escolha uma senha com pelo menos 6 caracteres.");
                return;
            }

            const newUser = await User.create({ 
                email, 
                password,
                whatsapp_phone: state.initiator_phone, 
                status: 'pending' 
            });

            const checkout = await subscriptionService.createSubscriptionCheckout(newUser.id);
            const paymentLink = checkout.checkoutUrl;
            const linkMessage = `✅ Ótimo! Seu pré-cadastro para o e-mail *${email}* foi criado com sucesso.\n\nAgora, o último passo para ativar sua conta:\n\n1️⃣ *Clique no link abaixo* para realizar o pagamento e ativar sua assinatura:\n${paymentLink}\n\n2️⃣ Após a confirmação do pagamento, sua conta será ativada automaticamente.\n\n3️⃣ Em seguida, basta me *remover e adicionar novamente a este grupo* para começarmos a configuração do seu primeiro projeto!`;
            
            await whatsappService.sendWhatsappMessage(groupId, linkMessage);
            await state.destroy();
        }
        break;
      
      case 'awaiting_profile_choice':
        const userId = state.user_id;
        const groupName = payload.chatName;

        if (textMessage && /^\d+$/.test(textMessage)) {
            const profiles = await profileService.getProfilesByUserId(userId);
            const selectedIndex = parseInt(textMessage, 10) - 1;
            const profile = profiles[selectedIndex];

            if (profile) {
                await groupService.startMonitoringGroup(groupId, profile.id, userId, groupName);
                await whatsappService.sendWhatsappMessage(groupId, `✅ Perfil "${profile.name}" selecionado!`);
                await this.startCategoryCreationFlow(state, profile.id);
            } else {
                await whatsappService.sendWhatsappMessage(groupId, `Opção inválida. Por favor, responda com um número da lista.`);
            }
            return;
        }

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
            const profileListText = profiles
                .map((p, index) => `${index + 1} - ${p.name}`)
                .join('\n');
            const message = `Seus perfis existentes:\n\n${profileListText}\n\nResponda com o *número* do perfil que você deseja usar para este grupo.`;
            await whatsappService.sendWhatsappMessage(groupId, message);
          }
        }
        break;
        
      case 'awaiting_new_profile_name':
        if (textMessage) {
          const groupNameForMonitoring = payload.chatName;
          const newProfile = await profileService.createProfile({ name: textMessage, user_id: state.user_id });
          await groupService.startMonitoringGroup(groupId, newProfile.id, state.user_id, groupNameForMonitoring);
          await whatsappService.sendWhatsappMessage(groupId, `✅ Perfil "${newProfile.name}" criado e vinculado a este grupo!`);
          await this.startCategoryCreationFlow(state, newProfile.id);
        }
        break;
      
      case 'awaiting_category_creation_start':
        if (buttonId === 'onboarding_add_category') {
            state.status = 'awaiting_new_category_name';
            await state.save();
            await whatsappService.sendWhatsappMessage(groupId, 'Qual o nome da nova categoria? (ex: "Elétrica", "Alvenaria")');
        } else if (buttonId === 'onboarding_finish') {
            const finalMessage = `👍 Configuração concluída! Já pode começar a registrar seus custos.

*Dica:* Você sabia que também pode acessar um painel web completo para ver gráficos, relatórios e gerenciar todos os seus dados?

Acesse em: https://obras-fabio.vercel.app/login`;

            await whatsappService.sendWhatsappMessage(groupId, finalMessage);
            await state.destroy();
        }
        break;

      case 'awaiting_new_category_name':
          if (textMessage) {
              state.status = 'awaiting_new_category_type';
              state.temp_category_name = textMessage;
              await state.save();
              await whatsappService.sendWhatsappMessage(groupId, `Entendido. Agora, defina um *tipo* para a categoria "*${textMessage}*".\n\nIsso ajuda a agrupar seus custos nos relatórios (ex: "Mão de Obra", "Material Bruto", "Acabamentos").`);
          }
          break;

      case 'awaiting_new_category_type':
          if (textMessage) {
              state.status = 'awaiting_new_category_goal';
              state.temp_category_type = textMessage.trim();
              await state.save();
              await whatsappService.sendWhatsappMessage(groupId, `Qual a *meta mensal de gastos* para a categoria "*${state.temp_category_name}*"?\n\nResponda apenas com o número (ex: 1500).\n\nSe não quiser definir uma meta, responda com *0*.`);
          }
          break;
      
      case 'awaiting_new_category_goal':
          if (textMessage) {
              const goalValue = parseFloat(textMessage.replace(',', '.'));
              if (isNaN(goalValue)) {
                  await whatsappService.sendWhatsappMessage(groupId, `Valor inválido. Por favor, responda apenas com números (ex: 1500 ou 0).`);
                  return;
              }

              const goalService = require('../GoalManager/goal.service');

              const newCategory = await categoryService.create(
                  { name: state.temp_category_name, type: state.temp_category_type },
                  state.profile_id
              );
              
              let goalMessage = `✅ Categoria "*${state.temp_category_name}*" criada com sucesso!`;

              if (goalValue > 0) {
                  await goalService.createOrUpdateGoal(state.profile_id, {
                      value: goalValue,
                      categoryId: newCategory.id
                  });
                  goalMessage += `\n🎯 Meta de gastos de *R$ ${goalValue.toFixed(2)}* definida.`;
              }
              
              await whatsappService.sendWhatsappMessage(groupId, goalMessage);
              
              await this.startCategoryCreationFlow(state, state.profile_id, false);
          }
          break;
    }
  }

  async startCategoryCreationFlow(state, profileId, isFirstTime = true) {
    state.status = 'awaiting_category_creation_start';
    state.profile_id = profileId;
    state.temp_category_name = null;
    state.temp_category_type = null;
    await state.save();
    const message = isFirstTime ? 'Agora, vamos configurar suas categorias de custo. Você pode criar quantas quiser.' : 'Deseja adicionar outra categoria?';
    const buttons = [ { id: 'onboarding_add_category', label: '➕ Adicionar Categoria' }, { id: 'onboarding_finish', label: '🏁 Finalizar Configuração' } ];
    await whatsappService.sendButtonList(state.group_id, message, buttons);
  }

  async handleButtonResponse(payload) {
    if (payload.fromMe) return;
    const buttonId = payload.buttonsResponseMessage.buttonId;
    if (buttonId.startsWith('edit_expense_')) {
      return this.handleEditButtonFlow(payload);
    }
    if (buttonId.startsWith('new_cat_')) {
      return this.handleNewCategoryDecisionFlow(payload);
    }
    if (buttonId.startsWith('pending_generate_link_')) {
        const userId = buttonId.split('_')[3];
        const checkout = await subscriptionService.createSubscriptionCheckout(userId);
        const linkMessage = `Aqui está seu novo link para pagamento:\n\n${checkout.checkoutUrl}\n\nApós a confirmação, remova-me e adicione-me novamente ao grupo para começar!`;
        await whatsappService.sendWhatsappMessage(payload.phone, linkMessage);
        await OnboardingState.destroy({ where: { group_id: payload.phone } });
    }
  }

  async handleMediaArrival(payload) {
    if (payload.fromMe) return;
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
    if (payload.fromMe) { return; }
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
    const buttons = [ { id: `new_cat_create_${pendingExpense.id}`, label: '✅ Criar e Usar' }, { id: `new_cat_choose_${pendingExpense.id}`, label: '📋 Escolher da Lista' }, { id: `new_cat_outros_${pendingExpense.id}`, label: '➡️ Usar "Outros"' }, ];
    await whatsappService.sendButtonList(pendingExpense.whatsapp_group_id, message, buttons);
    logger.info(`[Webhook] Nova categoria "${categoryName}" sugerida. Aguardando decisão do usuário para pendência #${pendingExpense.id}.`);
  }

  async createExpenseAndStartEditFlow(pendingExpense, analysisResult, userContext, categoryId) {
    const { value, baseDescription } = analysisResult;
    const finalDescriptionForDB = userContext ? `${baseDescription} (${userContext})` : baseDescription;
    const category = await Category.findByPk(categoryId);
    const newExpense = await Expense.create({ value, description: finalDescriptionForDB, expense_date: pendingExpense.createdAt, whatsapp_message_id: pendingExpense.whatsapp_message_id, category_id: categoryId, profile_id: pendingExpense.profile_id, });
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
    if (!pendingExpense) { await whatsappService.sendWhatsappMessage(groupId, `⏳ O tempo para esta decisão expirou.`); return; }
    if (action === 'create') {
        pendingExpense.status = 'awaiting_new_category_type';
        await pendingExpense.save();
        await whatsappService.sendWhatsappMessage(groupId, `Entendido! A qual tipo de custo a categoria "*${pendingExpense.suggested_new_category_name}*" pertence?\n\nResponda com uma das opções: *Material*, *Mão de Obra*, *Serviços/Equipamentos* ou *Outros*.`);
    } else if (action === 'choose') {
        payload.buttonsResponseMessage.buttonId = `edit_expense_${pendingExpenseId}`;
        await this.handleEditButtonFlow(payload);
    } else if (action === 'outros') {
        const outrosCategory = await Category.findOne({ where: { name: 'Outros', profile_id: profileId } });
        if (!outrosCategory) { await whatsappService.sendWhatsappMessage(groupId, `❌ Erro crítico: A categoria "Outros" não foi encontrada para este perfil.`); return; }
        const analysisResult = { value: pendingExpense.value, baseDescription: pendingExpense.description.split(' (')[0] };
        const userContext = pendingExpense.description.match(/\(([^)]+)\)/)?.[1] || '';
        await this.createExpenseAndStartEditFlow(pendingExpense, analysisResult, userContext, outrosCategory.id);
    }
  }

  async finalizeNewCategoryCreation(pendingExpense, categoryType) {
    const validTypes = ['Material', 'Mão de Obra', 'Serviços/Equipamentos', 'Outros'];
    const normalizedType = validTypes.find(t => t.toLowerCase() === categoryType.trim().toLowerCase());
    if (!normalizedType) { await whatsappService.sendWhatsappMessage(pendingExpense.whatsapp_group_id, `⚠️ Tipo inválido. Por favor, responda com uma das opções: *Material*, *Mão de Obra*, *Serviços/Equipamentos* ou *Outros*.`); return; }
    const newCategory = await categoryService.create({ name: pendingExpense.suggested_new_category_name, type: normalizedType, }, pendingExpense.profile_id);
    const newExpense = await Expense.create({ value: pendingExpense.value, description: pendingExpense.description, expense_date: pendingExpense.createdAt, whatsapp_message_id: pendingExpense.whatsapp_message_id, category_id: newCategory.id, profile_id: pendingExpense.profile_id, });
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
      if (!pendingExpense) { await whatsappService.sendWhatsappMessage(groupId, `⏳ *Tempo Esgotado* ⏳\n\nO prazo para editar esta despesa já expirou ou ela não existe.`); return; }
      if (pendingExpense.participant_phone !== clickerPhone) { await whatsappService.sendWhatsappMessage(groupId, `🤚 *Atenção, ${clickerPhone}!* \n\nApenas a pessoa que registrou a despesa (${pendingExpense.participant_phone}) pode editá-la.`); return; }
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
    if (!pendingExpense) { logger.warn(`[Webhook] Resposta numérica de ${participantPhone} ignorada.`); return false; }
    const allCategories = await Category.findAll({ where: { profile_id: profileId }, order: [['name', 'ASC']] });
    const selectedCategory = allCategories[selectedNumber - 1];
    if (!selectedCategory) { const totalCategories = allCategories.length; await whatsappService.sendWhatsappMessage(groupId, `⚠️ *Opção Inválida!* \n\nO número *${selectedNumber}* não está na lista. Responda com um número entre 1 e ${totalCategories}.`); return true; }
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