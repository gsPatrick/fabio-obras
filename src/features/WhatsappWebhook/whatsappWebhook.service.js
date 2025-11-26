// src/features/WhatsappWebhook/whatsappWebhook.service.js
'use strict';

const logger = require('../../utils/logger');
const { MonitoredGroup, Category, PendingExpense, Expense, Revenue, Profile, User, OnboardingState, MonthlyGoal, CreditCard, sequelize } = require('../../models');
const subscriptionService = require('../../services/subscriptionService');
const profileService = require('../ProfileManager/profile.service');
const groupService = require('../GroupManager/group.service');
const categoryService = require('../CategoryManager/category.service');
const creditCardService = require('../CreditCardManager/creditCard.service');
const { Op } = require('sequelize');
const aiService = require('../../utils/aiService');
const whatsappService = require('../../utils/whatsappService');
const dashboardService = require('../../features/Dashboard/dashboard.service');
const excelService = require('../../utils/excelService');
const fs = require('fs');
const path = require('path');
const { startOfMonth, format, getMonth, getYear, addMonths, setDate, isAfter, endOfDay, startOfDay, subDays, eachDayOfInterval } = require('date-fns');

// --- CONSTANTES DE TEMPO (1 ANO PARA EVITAR TIMEOUT) ---
const CONTEXT_WAIT_TIME_MINUTES = 525600; 
const EXPENSE_EDIT_WAIT_TIME_MINUTES = 525600;
const ONBOARDING_WAIT_TIME_MINUTES = 60; 
const MENU_COMMAND = 'MENU';

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
    } else if (phone.length === 10 || phone.length === 11) { 
      variations.add(`55${phone}`);
      if (phone.length === 10) { 
        variations.add(`55${phone.substring(0,2)}9${phone.substring(2)}`);
      } else if (phone.length === 11 && phone.startsWith('9', 2)) { 
        variations.add(`55${phone.substring(0,2)}${phone.substring(3)}`);
      }
    }
    logger.info(`[Auth] Buscando usuário com variações de telefone: ${Array.from(variations).join(', ')}`);
    return User.findOne({ where: { whatsapp_phone: { [Op.in]: Array.from(variations) } } });
  }

  async _fuzzyFindCategory(profileId, text) {
      if (!text) return null;
      const cleanText = text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();
      const allCategories = await Category.findAll({ where: { profile_id: profileId } });

      let match = allCategories.find(c => {
          const cName = c.name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();
          return cName === cleanText;
      });
      if (match) return match;

      if (cleanText.endsWith('s')) {
          const singularText = cleanText.slice(0, -1);
          match = allCategories.find(c => {
              const cName = c.name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();
              return cName === singularText;
          });
          if (match) return match;
      } else {
          const pluralText = cleanText + 's';
          match = allCategories.find(c => {
              const cName = c.name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();
              return cName === pluralText;
          });
          if (match) return match;
      }

      match = allCategories.find(c => {
          const cName = c.name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();
          return cName.includes(cleanText) || cleanText.includes(cName);
      });
      
      return match || null;
  }

  async processIncomingMessage(payload) {
    if (payload.type !== 'ReceivedCallback' && payload.notification !== 'GROUP_CREATE') {
        logger.debug(`[Webhook] Ignorando payload de tipo '${payload.type}'.`);
        return;
    }

    if (payload.fromMe) { return; }
    if (payload.notification === 'GROUP_CREATE') { return this.handleGroupJoin(payload); }
    
    const onboardingState = await OnboardingState.findOne({ where: { group_id: payload.phone } });
    if (onboardingState) { 
        return this.handleOnboardingResponse(payload, onboardingState); 
    }

    if (!payload.isGroup) { 
        const participantPhone = payload.participantPhone;
        const user = await this._findUserByFlexiblePhone(participantPhone);
        if (user && user.status === 'pending') {
            logger.info(`[Webhook] Mensagem de usuário pendente (${user.email}) em grupo não monitorado.`);
            await this.startPendingPaymentFlow(payload.phone, participantPhone, user);
            return;
        }
        return; 
    }

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
        return; 
    }

    const groupWithDetails = await MonitoredGroup.findOne({ 
        where: { id: monitoredGroup.id }, 
        include: [{ model: Profile, as: 'profile', include: [{ model: User, as: 'user' }] }] 
    });

    if (!groupWithDetails.profile || !groupWithDetails.profile.user) { return; }

    const ownerUserId = groupWithDetails.profile.user.id;
    const isPlanActive = await subscriptionService.isUserActive(ownerUserId);

    if (!isPlanActive) {
      const checkout = await subscriptionService.createSubscriptionCheckout(ownerUserId);
      const paymentMessage = `Sua assinatura não está ativa. Para continuar registrando despesas, por favor, renove seu plano através do link abaixo:\n\n${checkout.checkoutUrl}`;
      await whatsappService.sendWhatsappMessage(payload.phone, paymentMessage);
      return;
    }

    payload.profileId = groupWithDetails.profile.id;
    
    if (payload.buttonsResponseMessage) { 
        return this.handleButtonResponse(payload); 
    }
    
    if (payload.text?.message?.toUpperCase().trim() === MENU_COMMAND) {
        return this.sendMainMenu(payload.phone, payload.participantPhone, payload.profileId);
    }
    
    const caption = payload.image?.caption || payload.document?.caption;
    if ((payload.image || payload.document) && caption) {
        payload.text = { message: caption };
        return this.handleContextArrival(payload);
    }
    
    if (payload.image || payload.document) { return this.handleMediaArrival(payload); }
    if (payload.audio || payload.text) { return this.handleContextArrival(payload); }
  }
  
  async sendMainMenu(groupId, participantPhone, profileId) {
    if (participantPhone && profileId) {
        await PendingExpense.destroy({ where: { participant_phone: participantPhone, profile_id: profileId, whatsapp_group_id: groupId } });
    }
    const message = `Olá! Escolha uma das opções abaixo:`;
    const buttons = [
        { id: 'menu_view_report', label: '📊 Ver Relatório Mensal' },
        { id: 'menu_export_excel', label: '📝 Exportar Planilha' },
        { id: 'menu_create_category', label: '➕ Criar Categoria' },
        { id: 'menu_manage_cards', label: '💳 Gerenciar Cartões' },
    ];
    await whatsappService.sendButtonList(groupId, message, buttons);
  }

  async handleGroupJoin(payload) {
    const groupId = payload.phone;
    const metadata = await whatsappService.getGroupMetadata(groupId);
    if (!metadata || !metadata.participants) { return; }

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
          break;
        }
      }
    }
  
    if (responsibleUser) {
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
    if (!ownerParticipant || !ownerParticipant.phone) return;

    const ownerPhone = ownerParticipant.phone;
    const ownerUser = await this._findUserByFlexiblePhone(ownerPhone);
  
    if (ownerUser) {
      if (ownerUser.status === 'pending') {
        await this.startPendingPaymentFlow(groupId, ownerPhone, ownerUser);
      } else {
        const checkout = await subscriptionService.createSubscriptionCheckout(ownerUser.id);
        const paymentMessage = `Olá! 👋 Para começar a monitorar os custos neste grupo, sua conta precisa de uma assinatura ativa.\n\nClique no link abaixo para reativar seu plano:\n\n${checkout.checkoutUrl}`;
        await whatsappService.sendWhatsappMessage(groupId, paymentMessage);
      }
    } else {
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
    if (!userIsInitiator || (state.user_id && userIsInitiator.id !== state.user_id) || (!state.user_id && payload.participantPhone !== state.initiator_phone)) {
        return;
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
                    await whatsappService.sendWhatsappMessage(groupId, `O e-mail ${email} já está cadastrado.`);
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

            const newUser = await User.create({ email, password, whatsapp_phone: state.initiator_phone, status: 'pending' });
            const checkout = await subscriptionService.createSubscriptionCheckout(newUser.id);
            const linkMessage = `✅ Ótimo! Cadastro criado. Ative sua conta aqui:\n${checkout.checkoutUrl}`;
            
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
          try {
            await subscriptionService._checkProfileLimit(userId);
            state.status = 'awaiting_new_profile_name';
            await state.save();
            await whatsappService.sendWhatsappMessage(groupId, "Ótimo! Por favor, me diga o nome para este novo perfil (ex: Obra Apartamento 101).");
          } catch (error) {
            await whatsappService.sendWhatsappMessage(groupId, `⚠️ *Limite Atingido!*\n\n${error.message}`);
            await state.destroy();
          }
        } else if (buttonId === 'onboarding_use_existing') {
          const profiles = await profileService.getProfilesByUserId(userId);
          if (!profiles || profiles.length === 0) {
            try {
              await subscriptionService._checkProfileLimit(userId);
              await whatsappService.sendWhatsappMessage(groupId, "Você ainda não possui perfis. Vamos criar o primeiro! Qual será o nome dele?");
              state.status = 'awaiting_new_profile_name';
              await state.save();
            } catch (error) {
              await whatsappService.sendWhatsappMessage(groupId, `⚠️ *Limite Atingido!*\n\n${error.message}`);
              await state.destroy();
            }
          } else {
            const profileListText = profiles.map((p, index) => `${index + 1} - ${p.name}`).join('\n');
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
            await whatsappService.sendWhatsappMessage(groupId, 'Qual o nome da nova categoria? (ex: "Elétrica", "Salário")');
        } else if (buttonId === 'onboarding_finish') {
            const finalMessage = `👍 Configuração concluída! Já pode começar a registrar seus custos e receitas.`;
            await whatsappService.sendWhatsappMessage(groupId, finalMessage);
            await state.destroy();
        }
        break;

      case 'awaiting_new_category_name':
          if (textMessage) {
              state.status = 'awaiting_new_category_type';
              state.temp_category_name = textMessage;
              await state.save();
              await whatsappService.sendWhatsappMessage(groupId, `Entendido. Agora, defina um *tipo* para a categoria "*${textMessage}*".\n\nIsso ajuda a agrupar seus custos nos relatórios (ex: "Mão de Obra", "Material Bruto", "Acabamentos", "Salário").`);
          }
          break;

      case 'awaiting_new_category_type':
          if (textMessage) {
              state.status = 'awaiting_category_flow_decision';
              state.temp_category_type = textMessage.trim();
              await state.save();
              const message = `A categoria "*${state.temp_category_name}*" será para *Despesas* ou *Receitas*?`;
              const buttons = [{ id: `onboarding_flow_expense`, label: '💸 Despesa' }, { id: `onboarding_flow_revenue`, label: '💰 Receita' }];
              await whatsappService.sendButtonList(groupId, message, buttons);
          }
          break;
      
      case 'awaiting_category_flow_decision':
        if (buttonId && (buttonId === 'onboarding_flow_expense' || buttonId === 'onboarding_flow_revenue')) {
            state.temp_category_flow = (buttonId === 'onboarding_flow_expense' ? 'expense' : 'revenue');
            if (state.temp_category_flow === 'expense') {
                state.status = 'awaiting_new_category_goal';
                await state.save();
                await whatsappService.sendWhatsappMessage(groupId, `Qual a *meta mensal de gastos* para a categoria "*${state.temp_category_name}*" (Despesa)?\n\nResponda apenas com o número (ex: 1500).\n\nSe não quiser definir uma meta, responda com *0*.`);
            } else {
                await this.finalizeNewCategoryOnboarding(state);
            }
        } else {
            await whatsappService.sendWhatsappMessage(groupId, `Opção inválida. Por favor, selecione "Despesa" ou "Receita".`);
        }
        break;

      case 'awaiting_new_category_goal':
          if (textMessage) {
              const goalValue = parseFloat(textMessage.replace(',', '.'));
              if (isNaN(goalValue) || goalValue < 0) {
                  await whatsappService.sendWhatsappMessage(groupId, `Valor inválido. Por favor, responda apenas com números positivos (ex: 1500 ou 0).`);
                  return;
              }
              await this.finalizeNewCategoryOnboarding(state, goalValue);
          }
          break;
    }
  }

  async finalizeNewCategoryOnboarding(state, goalValue = 0) {
    const { group_id, profile_id, temp_category_name, temp_category_type, temp_category_flow } = state;
    try {
        const newCategory = await categoryService.create(
            { name: temp_category_name, type: temp_category_type, category_flow: temp_category_flow },
            profile_id
        );
        let goalMessage = '';
        if (temp_category_flow === 'expense' && goalValue > 0) {
            const goalService = require('../GoalManager/goal.service');
            await goalService.createOrUpdateGoal(profile_id, {
                value: goalValue,
                categoryId: newCategory.id,
                isTotalGoal: false,
            });
            goalMessage = `\n🎯 Meta de gastos de *R$ ${goalValue.toFixed(2)}* definida.`;
        }
        await whatsappService.sendWhatsappMessage(group_id, `✅ Categoria "*${temp_category_name}*" criada com sucesso!${goalMessage}`);
        await this.startCategoryCreationFlow(state, profile_id, false);
    } catch (error) {
        logger.error('[Webhook] Erro ao finalizar criação de categoria de PendingExpense (Onboarding):', error);
        await whatsappService.sendWhatsappMessage(group_id, `❌ Houve um erro ao criar a categoria "${temp_category_name}". ${error.message}`);
        await state.destroy();
    }
  }

  async startCategoryCreationFlow(state, profileId, isFirstTime = true) {
    state.status = 'awaiting_category_creation_start';
    state.profile_id = profileId;
    state.temp_category_name = null;
    state.temp_category_type = null;
    state.temp_category_flow = null;
    await state.save();
    const message = isFirstTime ? 'Agora, vamos configurar suas categorias de custo e receita. Você pode criar quantas quiser.' : 'Deseja adicionar outra categoria, ou já podemos finalizar a configuração?';
    const buttons = [ { id: 'onboarding_add_category', label: '➕ Adicionar Categoria' }, { id: 'onboarding_finish', label: '🏁 Finalizar Configuração' } ];
    await whatsappService.sendButtonList(state.group_id, message, buttons);
  }

  async handleButtonResponse(payload) {
    if (payload.fromMe) return;
    const buttonId = payload.buttonsResponseMessage.buttonId;
    const groupId = payload.phone;
    const participantPhone = payload.participantPhone;
    const profileId = payload.profileId;

    // -- FLUXO DE BUSCA MANUAL --
    if (buttonId.startsWith('search_manual_cat_')) {
        const pendingExpenseId = buttonId.split('_')[3];
        const pending = await PendingExpense.findByPk(pendingExpenseId, { where: { profile_id: profileId } });
        if (pending) {
            pending.action_expected = 'awaiting_manual_category_search';
            await pending.save();
            await whatsappService.sendWhatsappMessage(groupId, '🔍 Digite o nome da categoria que você quer buscar:');
        }
        return;
    }

    if (buttonId.startsWith('menu_')) {
        const action = buttonId.split('_')[1];
        await PendingExpense.destroy({ where: { participant_phone: participantPhone, profile_id: profileId, whatsapp_group_id: groupId } });

        if (action === 'view') { 
            await this.sendSpendingReport(groupId, participantPhone, profileId);
        } else if (action === 'export') { 
            await this.sendExpensesExcelReport(groupId, participantPhone, profileId);
        } else if (action === 'create') { 
             await PendingExpense.create({ 
                whatsapp_message_id: payload.messageId + '_menu_cat',
                whatsapp_group_id: groupId,
                participant_phone: participantPhone,
                profile_id: profileId,
                action_expected: 'awaiting_new_category_name',
                expires_at: new Date(Date.now() + EXPENSE_EDIT_WAIT_TIME_MINUTES * 60 * 1000),
             });
             await whatsappService.sendWhatsappMessage(groupId, 'Qual o nome da nova categoria?');
        } else if (action === 'manage') { 
            return this.handleManageCardsAction(groupId, participantPhone, profileId, payload.messageId);
        }
        return;
    }

    if (buttonId.startsWith('edit_expense_')) {
      return this.handleEditButtonFlow(payload);
    }
    
    if (buttonId.startsWith('new_cat_flow_')) {
        return this.handleNewCategoryFlowDecision(payload);
    }
    
    if (buttonId.startsWith('new_cat_')) {
      return this.handleNewCategoryDecisionFlow(payload);
    }
    
    if (buttonId.startsWith('card_')) {
        return this.handleCreditCardButtonResponse(payload);
    }

    if (buttonId.startsWith('pending_generate_link_')) {
        const userId = buttonId.split('_')[3];
        const checkout = await subscriptionService.createSubscriptionCheckout(userId);
        const linkMessage = `Aqui está seu novo link para pagamento:\n\n${checkout.checkoutUrl}\n\nApós a confirmação, remova-me e adicione-me novamente ao grupo para começar!`;
        await whatsappService.sendWhatsappMessage(groupId, linkMessage);
        await OnboardingState.destroy({ where: { group_id: payload.phone } });
    }
  }

  async handleManageCardsAction(groupId, participantPhone, profileId, messageId) {
    const cards = await creditCardService.getAllCreditCards(profileId);
    let message = '💳 *Gerenciar Cartões de Crédito*\n\n';
    const buttons = [];

    if (cards.length > 0) {
        message += '*Seus cartões cadastrados:*\n';
        cards.forEach((card, index) => {
            message += `${index + 1} - ${card.name} (final ${card.last_four_digits || 'N/A'})\n`;
        });
        message += '\n'; 
    } else {
        message += 'Você ainda não tem cartões de crédito cadastrados.\n\n';
    }
    
    buttons.push({ id: `card_create_${messageId}`, label: '➕ Criar Novo Cartão' });
    buttons.push({ id: `menu_back_to_main_${messageId}`, label: '↩️ Voltar ao Menu Principal' });
    await whatsappService.sendButtonList(groupId, message, buttons);
  }

  async handleCreditCardButtonResponse(payload) {
    const buttonId = payload.buttonsResponseMessage.buttonId;
    const groupId = payload.phone;
    const profileId = payload.profileId;
    const participantPhone = payload.participantPhone;
    const messageId = buttonId.split('_')[2];

    if (buttonId.startsWith('card_create_')) {
        await PendingExpense.destroy({ 
            where: { 
                participant_phone: participantPhone, 
                whatsapp_group_id: groupId, 
                profile_id: profileId, 
                action_expected: { [Op.like]: 'awaiting_new_card_%' } 
            } 
        });

        await PendingExpense.create({
            whatsapp_message_id: messageId,
            whatsapp_group_id: groupId,
            participant_phone: participantPhone,
            profile_id: profileId,
            action_expected: 'awaiting_new_card_name',
            expires_at: new Date(Date.now() + EXPENSE_EDIT_WAIT_TIME_MINUTES * 60 * 1000),
        });
        await whatsappService.sendWhatsappMessage(groupId, `Ok! Qual será o *nome* do novo cartão?`);
    } else if (buttonId.startsWith('card_confirm_create_')) {
        const pendingExpenseId = buttonId.split('_')[3];
        const pending = await PendingExpense.findByPk(pendingExpenseId, { where: { profile_id: profileId } });

        if (!pending) {
            await whatsappService.sendWhatsappMessage(groupId, `⏳ O tempo para esta decisão expirou.`);
            return;
        }

        try {
            const newCard = await creditCardService.createCreditCard(pending.profile_id, {
                name: pending.suggested_new_category_name,
                closing_day: pending.value,
                due_day: pending.description,
                last_four_digits: null, 
            });
            await whatsappService.sendWhatsappMessage(groupId, `✅ Cartão "*${newCard.name}*" criado com sucesso!\n\nFechamento: dia ${newCard.closing_day}\nVencimento: dia ${newCard.due_day}.`);
            await pending.destroy();
            await this.sendMainMenu(groupId, participantPhone, profileId);
        } catch (error) {
            await whatsappService.sendWhatsappMessage(groupId, `❌ Ocorreu um erro ao criar o cartão. ${error.message}`);
            await pending.destroy();
        }

    } else if (buttonId.startsWith('card_cancel_create_')) {
        const pendingExpenseId = buttonId.split('_')[3];
        const pending = await PendingExpense.findByPk(pendingExpenseId, { where: { profile_id: profileId } });
        if (pending) await pending.destroy();
        await whatsappService.sendWhatsappMessage(groupId, `Criação de cartão cancelada.`);
        await this.sendMainMenu(groupId, participantPhone, profileId);
    } else if (buttonId.startsWith('menu_back_to_main_')) {
        return this.sendMainMenu(groupId, participantPhone, profileId);
    }
  }

  async handleCreditCardCreationFlowFromPending(payload, pending) {
    const groupId = payload.phone;
    const participantPhone = payload.participantPhone;
    const profileId = payload.profileId;
    const textMessage = payload.text?.message;

    switch (pending.action_expected) {
        case 'awaiting_new_card_name':
            if (textMessage) {
                pending.suggested_new_category_name = textMessage.trim(); 
                pending.action_expected = 'awaiting_new_card_closing_day';
                await pending.save();
                await whatsappService.sendWhatsappMessage(groupId, `Certo, o nome será "*${pending.suggested_new_category_name}*".\n\nAgora, qual o *dia de fechamento da fatura*? (Responda apenas com o número do dia, de 1 a 31. Ex: 10)`);
            }
            break;
        case 'awaiting_new_card_closing_day':
            if (textMessage && /^\d+$/.test(textMessage)) {
                const day = parseInt(textMessage, 10);
                if (day >= 1 && day <= 31) {
                    pending.value = day; 
                    pending.action_expected = 'awaiting_new_card_due_day';
                    await pending.save();
                    await whatsappService.sendWhatsappMessage(groupId, `Dia de fechamento definido para o dia *${day}*.\n\nE qual o *dia de vencimento da fatura*?`);
                } else {
                    await whatsappService.sendWhatsappMessage(groupId, `Dia inválido.`);
                }
            }
            break;
        case 'awaiting_new_card_due_day':
            if (textMessage && /^\d+$/.test(textMessage)) {
                const day = parseInt(textMessage, 10);
                if (day >= 1 && day <= 31) {
                    pending.description = day.toString();
                    try {
                        const closingDayInt = parseInt(pending.value, 10);
                        const dueDayInt = parseInt(pending.description, 10);
                        const newCard = await creditCardService.createCreditCard(pending.profile_id, {
                            name: pending.suggested_new_category_name,
                            closing_day: closingDayInt,
                            due_day: dueDayInt,
                            last_four_digits: null,
                        });
                        await whatsappService.sendWhatsappMessage(groupId, `✅ Cartão "*${newCard.name}*" criado!`);
                        await pending.destroy();
                        await this.sendMainMenu(groupId, participantPhone, profileId);
                    } catch (error) {
                        await whatsappService.sendWhatsappMessage(groupId, `❌ Erro: ${error.message}`);
                        await pending.destroy();
                    }
                } else {
                    await whatsappService.sendWhatsappMessage(groupId, `Dia inválido.`);
                }
            }
            break;
    }
  }


  async handleMediaArrival(payload) {
    if (payload.fromMe) return;
    const groupId = payload.phone;
    const participantPhone = payload.participantPhone;
    const profileId = payload.profileId;
    const mediaUrl = payload.image ? payload.image.imageUrl : payload.document.documentUrl;
    const mimeType = payload.image ? payload.image.mimeType : payload.document.mimeType;
    
    await PendingExpense.destroy({ 
        where: { 
            participant_phone: participantPhone, 
            whatsapp_group_id: groupId, 
            profile_id: profileId,
        } 
    });
    
    await PendingExpense.create({
      whatsapp_message_id: payload.messageId,
      whatsapp_group_id: groupId,
      participant_phone: participantPhone,
      attachment_url: mediaUrl,
      attachment_mimetype: mimeType,
      action_expected: 'awaiting_context',
      profile_id: profileId,
      expires_at: new Date(Date.now() + CONTEXT_WAIT_TIME_MINUTES * 60 * 1000), 
    });
    await whatsappService.sendWhatsappMessage(groupId, `📄 Recebi. Qual a descrição e valor? (ex: "500 aluguel")`);
  }

  async handleContextArrival(payload) {
    if (payload.fromMe) { return; }
    const textMessage = payload.text ? payload.text.message : null;

    if (textMessage && textMessage.includes('\n')) {
        const lines = textMessage.split('\n').filter(line => line.trim() !== '');
        for (const line of lines) {
            const singleLinePayload = { ...payload, text: { message: line } };
            await this._processSingleContext(singleLinePayload);
        }
        return;
    }
    await this._processSingleContext(payload);
  }

  async _processSingleContext(payload) {
    const groupId = payload.phone;
    const participantPhone = payload.participantPhone;
    const profileId = payload.profileId;
    const textMessage = payload.text ? payload.text.message.trim() : null;
    const audioUrl = payload.audio ? payload.audio.audioUrl : null;

    if (!profileId) return;

    const containsNumber = textMessage && /\d/.test(textMessage);
    
    const pendingFlow = await PendingExpense.findOne({
        where: { 
            participant_phone: participantPhone, 
            whatsapp_group_id: groupId, 
            profile_id: profileId, 
            action_expected: { [Op.notIn]: ['awaiting_context', 'awaiting_validation', 'awaiting_category_reply'] }
        },
        order: [['createdAt', 'DESC']]
    });

    if (containsNumber && pendingFlow) {
        const statesWaitingForName = [
            'awaiting_new_category_name', 
            'awaiting_new_category_type',
            'awaiting_new_card_name',
            'awaiting_manual_category_search' 
        ];
        
        if (!statesWaitingForName.includes(pendingFlow.action_expected)) {
            logger.info(`[Webhook] Novo comando com número detectado. Resetando fluxo anterior.`);
            await pendingFlow.destroy();
        }
    }

    const activeFlow = await PendingExpense.findOne({
        where: { 
            participant_phone: participantPhone, 
            whatsapp_group_id: groupId, 
            profile_id: profileId,
            action_expected: { [Op.notIn]: ['awaiting_context', 'awaiting_validation', 'awaiting_category_reply'] }
        }
    });

    if (textMessage && textMessage.toLowerCase().trim() === '#relatorio') {
        return this.sendSpendingReport(groupId, participantPhone, profileId);
    }
    if (textMessage && textMessage.toLowerCase().trim() === '#exportardespesas') {
        return this.sendExpensesExcelReport(groupId, participantPhone, profileId);
    }

    if (textMessage && /^\d+$/.test(textMessage) && activeFlow) {
         if (!['awaiting_new_card_closing_day', 'awaiting_new_card_due_day', 'awaiting_manual_category_search'].includes(activeFlow.action_expected)) {
             const handled = await this.handleNumericReply(payload, parseInt(textMessage, 10));
             if (handled) return;
         }
    }

    if (activeFlow) {
        if (activeFlow.action_expected === 'awaiting_manual_category_search' && textMessage) {
            return this._handleManualCategoryInputInFlow(payload, activeFlow, textMessage);
        }

        if (activeFlow.action_expected === 'awaiting_new_category_flow_decision' && textMessage) {
             return this._handleManualCategoryInputInFlow(payload, activeFlow, textMessage);
        }

        if (['awaiting_new_category_name', 'awaiting_new_category_type', 'awaiting_category_flow_decision', 'awaiting_new_category_goal'].includes(activeFlow.action_expected)) {
            return this.handleNewCategoryCreationFlowFromPending(payload, activeFlow);
        }
        if (['awaiting_new_card_name', 'awaiting_new_card_closing_day', 'awaiting_new_card_due_day', 'awaiting_card_creation_confirmation'].includes(activeFlow.action_expected)) {
            return this.handleCreditCardCreationFlowFromPending(payload, activeFlow);
        }
    }
    
    const hasMediaInPayload = payload.image || payload.document;
    if (hasMediaInPayload) {
        await whatsappService.sendWhatsappMessage(groupId, `🤖 Analisando documento e sua descrição...`);
        const userContext = textMessage;
        const mediaUrl = payload.image?.imageUrl || payload.document?.documentUrl;
        const mimeType = payload.image?.mimeType || payload.document?.mimeType;

        const mediaBuffer = await whatsappService.downloadZapiMedia(mediaUrl);
        if (mediaBuffer && userContext) {
            const tempPending = await PendingExpense.create({
                whatsapp_message_id: payload.messageId,
                whatsapp_group_id: groupId,
                participant_phone: participantPhone,
                profile_id: profileId,
                action_expected: 'awaiting_ai_analysis_complete',
                expires_at: new Date(Date.now() + CONTEXT_WAIT_TIME_MINUTES * 60 * 1000),
            });
            
            const cardNames = (await creditCardService.getAllCreditCards(profileId)).map(c => c.name);
            const analysisResult = await aiService.analyzeExpenseWithImage(mediaBuffer, userContext, mimeType, profileId, cardNames);
            
            if (analysisResult) {
                return this.decideAndSaveExpenseOrRevenue(tempPending, analysisResult, userContext);
            } else {
                await whatsappService.sendWhatsappMessage(groupId, `❌ Desculpe, não consegui analisar. Tente novamente.`);
                await tempPending.destroy();
            }
        } else {
            await whatsappService.sendWhatsappMessage(groupId, `❌ Erro no arquivo.`);
        }
        return;
    }

    if (textMessage || audioUrl) {
        await whatsappService.sendWhatsappMessage(groupId, `🤖 Analisando...`);
        let userContext = '';
        if (audioUrl) {
          const audioBuffer = await whatsappService.downloadZapiMedia(audioUrl);
          userContext = audioBuffer ? await aiService.transcribeAudio(audioBuffer) : '';
        } else {
          userContext = textMessage;
        }

        if (userContext) {
            await PendingExpense.destroy({ where: { participant_phone: participantPhone, whatsapp_group_id: groupId, profile_id: profileId } });

            const tempPending = await PendingExpense.create({
                whatsapp_message_id: payload.messageId,
                whatsapp_group_id: groupId,
                participant_phone: participantPhone,
                profile_id: profileId,
                action_expected: 'awaiting_ai_analysis_complete',
                expires_at: new Date(Date.now() + CONTEXT_WAIT_TIME_MINUTES * 60 * 1000), 
            });
            
            const cardNames = (await creditCardService.getAllCreditCards(profileId)).map(c => c.name);
            const analysisResult = await aiService.analyzeTextForExpenseOrRevenue(userContext, profileId, cardNames);
            
            if (analysisResult && analysisResult.value !== null) {
               return this.decideAndSaveExpenseOrRevenue(tempPending, analysisResult, userContext);
            } else if (analysisResult && analysisResult.cardName) {
               tempPending.suggested_new_category_name = analysisResult.cardName;
               tempPending.value = analysisResult.closingDay;
               tempPending.description = analysisResult.dueDay;
               tempPending.action_expected = 'awaiting_card_creation_confirmation';
               await tempPending.save();
               const buttons = [ { id: `card_confirm_create_${tempPending.id}`, label: '✅ Criar Cartão' }, { id: `card_cancel_create_${tempPending.id}`, label: '❌ Cancelar' } ];
               await whatsappService.sendButtonList(groupId, `Criar cartão "${analysisResult.cardName}"?`, buttons);
               return;
            }
            
            await whatsappService.sendWhatsappMessage(groupId, `❌ Não entendi. Tente: "500 aluguel"`);
            await tempPending.destroy();
        }
    }
  }

  async _handleManualCategoryInputInFlow(payload, pendingExpense, textMessage) {
      const groupId = payload.phone;
      const profileId = payload.profileId;

      logger.info(`[Webhook] Tentando mapeamento manual de categoria: "${textMessage}"`);
      
      const existingCategory = await this._fuzzyFindCategory(profileId, textMessage);
      
      if (existingCategory) {
           const analysisResult = {
                value: pendingExpense.value,
                baseDescription: pendingExpense.description, 
                categoryName: existingCategory.name,
                flow: existingCategory.category_flow,
                isInstallment: !!pendingExpense.installment_count,
                installmentCount: pendingExpense.installment_count,
                cardName: null, 
            };
            let userContext = '';
            if (pendingExpense.description && typeof pendingExpense.description === 'string') {
                const match = pendingExpense.description.match(/\(([^)]+)\)/);
                if (match) userContext = match[1];
            }
            
            await whatsappService.sendWhatsappMessage(groupId, `✅ Entendido! Classificado como *${existingCategory.name}*.`);
            await this.createExpenseOrRevenueAndStartEditFlow(pendingExpense, analysisResult, userContext, existingCategory.id, pendingExpense.credit_card_id);
      } else {
           pendingExpense.suggested_new_category_name = textMessage;
           pendingExpense.action_expected = 'awaiting_new_category_flow_decision'; 
           await pendingExpense.save();
           
           const message = `🤔 Não encontrei a categoria "${textMessage}". Deseja criar como:`;
           const buttons = [ 
               { id: `new_cat_flow_expense_${pendingExpense.id}`, label: '💸 Criar Despesa' }, 
               { id: `new_cat_flow_revenue_${pendingExpense.id}`, label: '💰 Criar Receita' },
               { id: `search_manual_cat_${pendingExpense.id}`, label: '🔍 Localizar Categoria' }
           ];
           await whatsappService.sendButtonList(groupId, message, buttons);
      }
  }

  async decideAndSaveExpenseOrRevenue(pendingData, analysisResult, userContext) {
    const { value, baseDescription, isInstallment, installmentCount, cardName, ambiguousCategoryNames } = analysisResult;
    const profileId = pendingData.profile_id;
    const groupId = pendingData.whatsapp_group_id;

    if (ambiguousCategoryNames && ambiguousCategoryNames.length > 0) {
        pendingData.value = value;
        pendingData.description = JSON.stringify(ambiguousCategoryNames);
        pendingData.suggested_new_category_name = baseDescription;
        pendingData.installment_count = isInstallment ? installmentCount : null;
        pendingData.action_expected = 'awaiting_ambiguous_category_choice';
        await pendingData.save();
        const categoryListText = ambiguousCategoryNames.map((name, index) => `${index + 1} - ${name}`).join('\n');
        await whatsappService.sendWhatsappMessage(groupId, `🤔 Qual categoria você quis dizer?\n\n${categoryListText}\n\nResponda com o número.`);
        return; 
    }

    let category = await this._fuzzyFindCategory(profileId, analysisResult.categoryName);

    if (!category && (analysisResult.categoryName.toLowerCase() === 'outros' && baseDescription.toLowerCase() !== 'outros')) {
        category = await this._fuzzyFindCategory(profileId, baseDescription);
    }

    if (category) {
        const finalFlow = category.category_flow;
        const resolvedAnalysis = { ...analysisResult, flow: finalFlow, categoryName: category.name };

        if (finalFlow === 'expense' && (isInstallment || cardName)) {
            pendingData.value = value;
            pendingData.description = baseDescription;
            pendingData.suggested_new_category_name = category.name;
            pendingData.installment_count = isInstallment ? installmentCount : null;
            pendingData.action_expected = 'awaiting_credit_card_choice';
            pendingData.suggested_category_id = category.id;
            await pendingData.save();
            
            const creditCards = await creditCardService.getAllCreditCards(profileId);
            if (creditCards.length > 0) {
                 const cardListText = creditCards.map((card, index) => `${index + 1} - ${card.name}`).join('\n');
                 await whatsappService.sendWhatsappMessage(groupId, `ℹ️ Qual cartão?\n\n${cardListText}\n\n(0 para dinheiro/débito)`);
            } else {
                 await this.createExpenseOrRevenueAndStartEditFlow(pendingData, resolvedAnalysis, userContext, category.id, null);
            }
        } else {
            await this.createExpenseOrRevenueAndStartEditFlow(pendingData, resolvedAnalysis, userContext, category.id, null);
        }
    } else {
        const categorySuggestion = analysisResult.categoryName !== 'Outros' ? analysisResult.categoryName : (baseDescription.split(' ')[0] || "Nova Categoria");
        
        pendingData.value = value;
        pendingData.description = userContext ? `${baseDescription} (${userContext})` : baseDescription;
        pendingData.suggested_new_category_name = categorySuggestion;
        pendingData.action_expected = 'awaiting_new_category_flow_decision';
        await pendingData.save();

        const message = `🤔 A categoria "*${categorySuggestion}*" é nova. O que deseja fazer?`;
        const buttons = [ 
            { id: `new_cat_flow_expense_${pendingData.id}`, label: '💸 Criar Despesa' }, 
            { id: `new_cat_flow_revenue_${pendingData.id}`, label: '💰 Criar Receita' },
            { id: `search_manual_cat_${pendingData.id}`, label: '🔍 Localizar Categoria' }
        ];
        await whatsappService.sendButtonList(groupId, message, buttons);
    }
  }

  async createExpenseOrRevenueAndStartEditFlow(pendingData, analysisResult, userContext, categoryId, creditCardId = null) {
    const { value, baseDescription, isInstallment, installmentCount } = analysisResult;
    const finalDescriptionForDB = userContext ? `${baseDescription} (${userContext})` : baseDescription;
    
    const category = await Category.findByPk(categoryId);
    if (!category) return;

    let createdEntry;
    const entryDate = new Date();
    let chargeDate = null;

    if (creditCardId) {
        const creditCard = await CreditCard.findByPk(creditCardId);
        if (creditCard) {
            const currentDay = entryDate.getDate();
            let chargeMonthDate = new Date(entryDate);
            if (currentDay > creditCard.closing_day) chargeMonthDate = addMonths(chargeMonthDate, 1);
            chargeDate = setDate(chargeMonthDate, creditCard.due_day);
        }
    }

    if (category.category_flow === 'expense') {
        const expenseToCreate = {
            value, description: finalDescriptionForDB, expense_date: entryDate,
            whatsapp_message_id: pendingData.whatsapp_message_id,
            category_id: categoryId, profile_id: pendingData.profile_id, credit_card_id: creditCardId,
            is_installment: isInstallment, total_installments: isInstallment ? installmentCount : null,
            current_installment_number: isInstallment ? 1 : null,
            installment_total_value: isInstallment ? (value * installmentCount) : null,
            charge_date: chargeDate,
        };
        createdEntry = await Expense.create(expenseToCreate);

        if (isInstallment && installmentCount > 1) {
            for (let i = 2; i <= installmentCount; i++) {
                let nextChargeDate = addMonths(chargeDate, i - 1);
                await Expense.create({
                    ...expenseToCreate,
                    value: value,
                    original_expense_id: createdEntry.id,
                    current_installment_number: i,
                    charge_date: nextChargeDate,
                    whatsapp_message_id: null,
                });
            }
        }
    } else {
        createdEntry = await Revenue.create({
            value, description: finalDescriptionForDB, revenue_date: entryDate,
            whatsapp_message_id: pendingData.whatsapp_message_id,
            category_id: categoryId, profile_id: pendingData.profile_id,
        });
    }

    pendingData.expense_id = createdEntry instanceof Expense ? createdEntry.id : null;
    pendingData.revenue_id = createdEntry instanceof Revenue ? createdEntry.id : null;
    pendingData.suggested_category_id = categoryId;
    pendingData.credit_card_id = creditCardId;
    pendingData.action_expected = 'awaiting_validation';
    pendingData.expires_at = new Date(Date.now() + EXPENSE_EDIT_WAIT_TIME_MINUTES * 60 * 1000); 
    await pendingData.save();

    const formattedValue = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
    let message = `✅ *Registrado:* ${formattedValue}\n*Categoria:* ${category.name}`;
    
    const now = new Date();
    const startOfCurrentMonth = startOfMonth(now);
    const endOfCurrentMonth = new Date();
    
    if (category.category_flow === 'expense') {
        const currentMonthTotalExpenses = await Expense.sum('value', { 
            where: { 
                profile_id: pendingData.profile_id, 
                [Op.or]: [
                    { expense_date: { [Op.between]: [startOfCurrentMonth, endOfCurrentMonth] } },
                    { charge_date: { [Op.between]: [startOfCurrentMonth, endOfCurrentMonth] } }
                ],
                original_expense_id: { [Op.eq]: null }
            } 
        });
        
        const categoryGoal = await MonthlyGoal.findOne({ where: { profile_id: pendingData.profile_id, category_id: category.id } });
        if (categoryGoal) {
             const currentCategoryExpenses = await Expense.sum('value', { 
                where: { 
                    profile_id: pendingData.profile_id, 
                    category_id: category.id,
                    [Op.or]: [
                        { expense_date: { [Op.between]: [startOfCurrentMonth, endOfCurrentMonth] } },
                        { charge_date: { [Op.between]: [startOfCurrentMonth, endOfCurrentMonth] } }
                    ],
                    original_expense_id: { [Op.eq]: null }
                } 
            });
            if (currentCategoryExpenses > parseFloat(categoryGoal.value)) {
                message += `\n\n🚨 *ALERTA:* Meta da categoria *${category.name}* excedida!`;
            }
        }
        
        const totalGoal = await MonthlyGoal.findOne({ where: { profile_id: pendingData.profile_id, is_total_goal: true, category_id: null } });
        if (totalGoal && currentMonthTotalExpenses && currentMonthTotalExpenses > parseFloat(totalGoal.value)) {
            message += `\n🚨 *ALERTA GERAL:* Meta total mensal excedida!`;
        }
    }

    const buttons = [{ id: `edit_expense_${pendingData.id}`, label: '✏️ Corrigir Categoria' }];
    await whatsappService.sendButtonList(pendingData.whatsapp_group_id, message, buttons);
  }

  async handleEditButtonFlow(payload) {
      const buttonId = payload.buttonsResponseMessage.buttonId;
      const groupId = payload.phone;
      const profileId = payload.profileId;
      const pendingExpenseId = buttonId.split('_')[2];
      
      const pendingExpense = await PendingExpense.findByPk(pendingExpenseId, { 
          where: { profile_id: profileId },
          include: [{ model: Expense, as: 'expense' }, { model: Revenue, as: 'revenue' }]
      });

      if (!pendingExpense) { await whatsappService.sendWhatsappMessage(groupId, `⏳ *Tempo Esgotado* ou não existe.`); return; }
      
      const allCategories = await Category.findAll({ 
          where: { profile_id: profileId }, 
          order: [['category_flow', 'DESC'],['name', 'ASC']]
      });

      const categoryListText = allCategories.map((cat, index) => `${index + 1} - ${cat.name} (${cat.category_flow === 'expense' ? 'Despesa' : 'Receita'})`).join('\n');
      const valueToFormat = pendingExpense.expense?.value || pendingExpense.revenue?.value || pendingExpense.value;
      const descriptionToUse = pendingExpense.expense?.description || pendingExpense.revenue?.description || pendingExpense.description;
      const originalFlow = pendingExpense.expense ? 'expense' : (pendingExpense.revenue ? 'revenue' : (pendingExpense.suggested_category_flow || 'despesa'));
      const flowText = originalFlow === 'expense' ? 'despesa' : 'receita';
      const formattedValue = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(valueToFormat);

      const message = `📋 *Editar Categoria* \n\nVocê está editando a ${flowText} *já salva* de *${formattedValue}* (${descriptionToUse}).\n\nResponda com o *número* da nova categoria: 👇\n\n${categoryListText}`;
      
      pendingExpense.action_expected = 'awaiting_category_reply';
      pendingExpense.expires_at = new Date(Date.now() + EXPENSE_EDIT_WAIT_TIME_MINUTES * 60 * 1000); 
      await pendingExpense.save();
      await whatsappService.sendWhatsappMessage(groupId, message);
  }

  async handleNumericReply(payload, selectedNumber) {
    const { phone: groupId, participantPhone, profileId } = payload;
    
    // --- LÓGICA RESTAURADA DO CÓDIGO 01 ---
    const pendingAmbiguity = await PendingExpense.findOne({
        where: { whatsapp_group_id: groupId, participant_phone: participantPhone, profile_id: profileId, action_expected: 'awaiting_ambiguous_category_choice' },
    });

    if (pendingAmbiguity) {
        try {
            const choices = JSON.parse(pendingAmbiguity.description);
            const chosenCategoryName = choices[selectedNumber - 1];
            if (!chosenCategoryName) return true;
            
            const resolvedAnalysisResult = {
                value: pendingAmbiguity.value,
                baseDescription: pendingAmbiguity.suggested_new_category_name,
                categoryName: chosenCategoryName,
                isInstallment: !!pendingAmbiguity.installment_count,
                installmentCount: pendingAmbiguity.installment_count,
                cardName: null,
            };
            await this.decideAndSaveExpenseOrRevenue(pendingAmbiguity, resolvedAnalysisResult, resolvedAnalysisResult.baseDescription);
            return true;
        } catch (error) {
            await pendingAmbiguity.destroy();
            return true;
        }
    }
    
    // -- FLUXOS DE CARTÃO E PARCELAS (ESSENCIAL PARA FUNCIONAR) --
    const isHandlingCreditCard = await this.handleNumericReplyForCreditCard(groupId, selectedNumber, participantPhone, profileId);
    if (isHandlingCreditCard) return true;

    const isHandlingInstallmentCount = await this.handleNumericReplyForInstallmentCount(groupId, selectedNumber, participantPhone, profileId);
    if (isHandlingInstallmentCount) return true;
    // -----------------------------------------------------------

    const pendingExpense = await PendingExpense.findOne({
      where: { whatsapp_group_id: groupId, participant_phone: participantPhone, profile_id: profileId, action_expected: 'awaiting_category_reply' },
      include: [{ model: Expense, as: 'expense' }, { model: Revenue, as: 'revenue' }]
    });

    if (!pendingExpense) return false;
    
    const allCategories = await Category.findAll({ where: { profile_id: profileId }, order: [['category_flow', 'DESC'], ['name', 'ASC']] });
    const selectedCategory = allCategories[selectedNumber - 1];

    if (!selectedCategory) { 
        await whatsappService.sendWhatsappMessage(groupId, `⚠️ *Opção Inválida!*`); 
        return true; 
    }

    let updatedEntry;
    if (pendingExpense.expense) {
        if (selectedCategory.category_flow !== 'expense') {
            const originalExpense = pendingExpense.expense;
            await Revenue.create({
                value: originalExpense.value, description: originalExpense.description, revenue_date: originalExpense.expense_date,
                whatsapp_message_id: originalExpense.whatsapp_message_id, category_id: selectedCategory.id, profile_id: originalExpense.profile_id,
            });
            await originalExpense.destroy();
            updatedEntry = await Revenue.findOne({where: {whatsapp_message_id: originalExpense.whatsapp_message_id}});
        } else {
            await pendingExpense.expense.update({ category_id: selectedCategory.id });
            updatedEntry = pendingExpense.expense;
        }
    } else if (pendingExpense.revenue) {
        if (selectedCategory.category_flow !== 'revenue') {
            const originalRevenue = pendingExpense.revenue;
            await Expense.create({
                value: originalRevenue.value, description: originalRevenue.description, expense_date: originalRevenue.revenue_date,
                whatsapp_message_id: originalRevenue.whatsapp_message_id, category_id: selectedCategory.id, profile_id: originalRevenue.profile_id,
            });
            await originalRevenue.destroy();
            updatedEntry = await Expense.findOne({where: {whatsapp_message_id: originalRevenue.whatsapp_message_id}});
        } else {
            await pendingExpense.revenue.update({ category_id: selectedCategory.id });
            updatedEntry = pendingExpense.revenue;
        }
    }
    await pendingExpense.destroy();
    await whatsappService.sendWhatsappMessage(groupId, `✅ Atualizado para: *${selectedCategory.name}*`);
    return true;
  }

  async handleNewCategoryDecisionFlow(payload) {
    const buttonId = payload.buttonsResponseMessage.buttonId;
    const parts = buttonId.split('_');
    const action = parts[2];
    const pendingExpenseId = parts[parts.length - 1];
    const groupId = payload.phone;
    const profileId = payload.profileId;

    const pendingExpense = await PendingExpense.findByPk(pendingExpenseId, { where: { profile_id: profileId } });
    if (!pendingExpense) { await whatsappService.sendWhatsappMessage(groupId, `⏳ O tempo para esta decisão expirou.`); return; }

    const suggestedFlow = pendingExpense.suggested_category_flow || 'expense';
    const otherCategoryName = suggestedFlow === 'expense' ? 'Outros' : 'Receita Padrão';

    if (action === 'create') {
        pendingExpense.action_expected = 'awaiting_new_category_type';
        await pendingExpense.save();
        await whatsappService.sendWhatsappMessage(groupId, `Entendido! A qual tipo de custo/receita a categoria "*${pendingExpense.suggested_new_category_name}*" pertence?\n\nResponda com um tipo (ex: "Material", "Mão de Obra", "Salário", "Serviço Avulso").`);
    } else if (action === 'choose') {
        payload.buttonsResponseMessage.buttonId = `edit_expense_${pendingExpenseId}`;
        await this.handleEditButtonFlow(payload);
    } else if (action === 'outros') {
        const finalCategory = await Category.findOne({ 
            where: { name: otherCategoryName, profile_id: profileId, category_flow: suggestedFlow } 
        });

        if (!finalCategory) { 
            await whatsappService.sendWhatsappMessage(groupId, `❌ Erro crítico: A categoria "${otherCategoryName}" não foi encontrada.`); 
            return; 
        }
        
        const analysisResult = {
            value: pendingExpense.value,
            baseDescription: pendingExpense.description,
            categoryName: finalCategory.name,
            flow: finalCategory.category_flow,
            isInstallment: !!pendingExpense.installment_count,
            installmentCount: pendingExpense.installment_count,
            cardName: null,
        };
        const userContext = pendingExpense.description.match(/\(([^)]+)\)/)?.[1] || '';
        await this.createExpenseOrRevenueAndStartEditFlow(pendingExpense, analysisResult, userContext, finalCategory.id);
    }
  }
  
  async handleNewCategoryFlowDecision(payload) {
    const buttonId = payload.buttonsResponseMessage.buttonId;
    const parts = buttonId.split('_');
    const flow = parts[3];
    const pendingExpenseId = parts[parts.length - 1];
    const groupId = payload.phone;
    const profileId = payload.profileId;

    const pendingExpense = await PendingExpense.findByPk(pendingExpenseId, { where: { profile_id: profileId } });
    if (!pendingExpense) { await whatsappService.sendWhatsappMessage(groupId, `⏳ O tempo para esta decisão expirou.`); return; }
    
    pendingExpense.suggested_category_flow = flow;
    if (flow === 'expense') {
        pendingExpense.action_expected = 'awaiting_new_category_goal';
        await pendingExpense.save();
        await whatsappService.sendWhatsappMessage(groupId, `Qual a *meta mensal de gastos* para a categoria "*${pendingExpense.suggested_new_category_name}*"?\n\nResponda apenas com o número (ex: 1500).\n\nSe não quiser definir uma meta, responda com *0*.`);
    } else {
        if (pendingExpense.whatsapp_message_id.endsWith('_menu_cat')) {
            await this._finalizeCategoryCreationFromMenu(pendingExpense);
        } else {
            await this.finalizeNewCategoryCreationFromPendingExpenseDecision(pendingExpense);
        }
    }
  }

  async finalizeNewCategoryCreationFromPendingExpenseDecision(pendingExpense, goalValue = 0) {
    const { whatsapp_group_id, profile_id, suggested_new_category_name, suggested_category_flow } = pendingExpense;
    
    const categoryType = pendingExpense.description || 'Outros'; 

    try {
        const newCategory = await categoryService.create(
            { name: suggested_new_category_name, type: categoryType, category_flow: suggested_category_flow },
            profile_id
        );
        
        let msg = `✅ Nova categoria "*${suggested_new_category_name}*" (${suggested_category_flow === 'expense' ? 'Despesa' : 'Receita'}) criada com sucesso!`;
        if (suggested_category_flow === 'expense' && goalValue > 0) {
            const goalService = require('../GoalManager/goal.service');
            await goalService.createOrUpdateGoal(profile_id, {
                value: goalValue,
                categoryId: newCategory.id,
                isTotalGoal: false,
            });
            msg += `\n🎯 Meta de gastos de *R$ ${goalValue.toFixed(2)}* definida.`;
        }

        await whatsappService.sendWhatsappMessage(whatsapp_group_id, msg);

        const analysisResult = {
            value: pendingExpense.value,
            baseDescription: pendingExpense.description,
            categoryName: newCategory.name,
            flow: newCategory.category_flow,
            isInstallment: !!pendingExpense.installment_count,
            installmentCount: pendingExpense.installment_count,
            cardName: null,
        };
        const userContext = pendingExpense.description.match(/\(([^)]+)\)/)?.[1] || '';
        await this.createExpenseOrRevenueAndStartEditFlow(pendingExpense, analysisResult, userContext, newCategory.id, pendingExpense.credit_card_id);

    } catch (error) {
        logger.error('[Webhook] Erro ao finalizar criação de categoria a partir de PendingExpense:', error);
        await whatsappService.sendWhatsappMessage(whatsapp_group_id, `❌ Houve um erro ao criar a categoria "${suggested_new_category_name}". ${error.message}`);
        await pendingExpense.destroy();
    }
  }

  async _finalizeCategoryCreationFromMenu(pendingExpense, goalValue = 0) {
    const { whatsapp_group_id, profile_id, suggested_new_category_name, suggested_category_flow } = pendingExpense;
    const categoryType = pendingExpense.description || 'Outros'; 

    try {
        const newCategory = await categoryService.create(
            { name: suggested_new_category_name, type: categoryType, category_flow: suggested_category_flow },
            profile_id
        );

        let msg = `✅ Nova categoria "*${suggested_new_category_name}*" (${suggested_category_flow === 'expense' ? 'Despesa' : 'Receita'}) foi criada com sucesso!`;

        if (suggested_category_flow === 'expense' && goalValue > 0) {
            const goalService = require('../GoalManager/goal.service');
            await goalService.createOrUpdateGoal(profile_id, {
                value: goalValue,
                categoryId: newCategory.id,
                isTotalGoal: false,
            });
            msg += `\n🎯 Meta de gastos de *R$ ${goalValue.toFixed(2)}* definida.`;
        }

        await whatsappService.sendWhatsappMessage(whatsapp_group_id, msg);
        await this.sendMainMenu(whatsapp_group_id, pendingExpense.participant_phone, profile_id);

    } catch (error) {
        logger.error('[Webhook] Erro ao finalizar criação de categoria vinda do MENU:', error);
        await whatsappService.sendWhatsappMessage(whatsapp_group_id, `❌ Houve um erro ao criar a categoria "${suggested_new_category_name}". ${error.message}`);
    } finally {
        await pendingExpense.destroy();
    }
  }
  
  async handleNewCategoryCreationFlowFromPending(payload, pending) {
    const groupId = payload.phone;
    const textMessage = payload.text?.message;
    const buttonId = payload.buttonsResponseMessage?.buttonId;

    switch (pending.action_expected) {
        case 'awaiting_new_category_name':
            if (textMessage) {
                pending.suggested_new_category_name = textMessage.trim();
                pending.action_expected = 'awaiting_new_category_type';
                await pending.save();
                await whatsappService.sendWhatsappMessage(groupId, `Entendido. Agora, defina um *tipo* para a categoria "*${textMessage}*".\n\nIsso ajuda a agrupar seus custos nos relatórios (ex: "Mão de Obra", "Material Bruto", "Acabamentos", "Salário").`);
            } else {
                await whatsappService.sendWhatsappMessage(groupId, `Por favor, me diga o nome da categoria.`);
            }
            break;

        case 'awaiting_new_category_type':
            if (textMessage) {
                pending.description = textMessage.trim(); 
                pending.action_expected = 'awaiting_category_flow_decision';
                await pending.save();
                const message = `A categoria "*${pending.suggested_new_category_name}*" será para *Despesas* ou *Receitas*?`;
                const buttons = [{ id: `new_cat_flow_expense_${pending.id}`, label: '💸 Despesa' }, { id: `new_cat_flow_revenue_${pending.id}`, label: '💰 Receita' }];
                await whatsappService.sendButtonList(groupId, message, buttons);
            }
            break;

        case 'awaiting_category_flow_decision':
             if (buttonId && (buttonId.startsWith('new_cat_flow_expense_') || buttonId.startsWith('new_cat_flow_revenue_'))) {
                const flow = buttonId.split('_')[3];
                pending.suggested_category_flow = flow;
                if (flow === 'expense') {
                    pending.action_expected = 'awaiting_new_category_goal';
                    await pending.save();
                    await whatsappService.sendWhatsappMessage(groupId, `Qual a *meta mensal de gastos* para a categoria "*${pending.suggested_new_category_name}*"?\n\nResponda apenas com o número (ex: 1500).\n\nSe não quiser definir uma meta, responda com *0*.`);
                } else {
                    if (pending.whatsapp_message_id.endsWith('_menu_cat')) {
                        await this._finalizeCategoryCreationFromMenu(pending);
                    } else {
                        await this.finalizeNewCategoryCreationFromPendingExpenseDecision(pending);
                    }
                }
            } else {
                await whatsappService.sendWhatsappMessage(groupId, `Opção inválida. Por favor, selecione "Despesa" ou "Receita".`);
            }
            break;

        case 'awaiting_new_category_goal':
            if (textMessage) {
                const goalValue = parseFloat(textMessage.replace(',', '.'));
                if (isNaN(goalValue) || goalValue < 0) {
                    await whatsappService.sendWhatsappMessage(groupId, `Valor inválido. Por favor, responda apenas com números positivos (ex: 1500 ou 0).`);
                    return;
                }
                if (pending.whatsapp_message_id.endsWith('_menu_cat')) {
                    await this._finalizeCategoryCreationFromMenu(pending, goalValue);
                } else {
                    await this.finalizeNewCategoryCreationFromPendingExpenseDecision(pending, goalValue);
                }
            }
            break;
    }
  }

  async handleNumericReplyForCreditCard(groupId, selectedNumber, participantPhone, profileId) {
    const pendingExpense = await PendingExpense.findOne({
      where: { whatsapp_group_id: groupId, participant_phone: participantPhone, profile_id: profileId, action_expected: 'awaiting_credit_card_choice' },
      order: [['createdAt', 'DESC']]
    });
    if (!pendingExpense) return false;

    const analysisResult = {
        value: pendingExpense.value,
        baseDescription: pendingExpense.description,
        categoryName: pendingExpense.suggested_new_category_name,
        flow: 'expense',
        isInstallment: !!pendingExpense.installment_count,
        installmentCount: pendingExpense.installment_count,
        cardName: null,
    };
    const userContext = pendingExpense.description.match(/\(([^)]+)\)/)?.[1] || '';
    const categoryId = pendingExpense.suggested_category_id;

    if (selectedNumber === 0) {
        await whatsappService.sendWhatsappMessage(groupId, `✅ Registrando como dinheiro/débito.`);
        return this.createExpenseOrRevenueAndStartEditFlow(pendingExpense, analysisResult, userContext, categoryId, null);
    }

    const creditCards = await creditCardService.getAllCreditCards(profileId);
    const selectedCard = creditCards[selectedNumber - 1];

    if (!selectedCard) {
        await whatsappService.sendWhatsappMessage(groupId, `⚠️ *Opção Inválida!*`);
        return true;
    }

    pendingExpense.credit_card_id = selectedCard.id;
    if (analysisResult.isInstallment && analysisResult.installmentCount > 1) {
        pendingExpense.action_expected = 'awaiting_installment_count';
        await pendingExpense.save();
        await whatsappService.sendWhatsappMessage(groupId, `Em quantas parcelas? (Total: ${analysisResult.installmentCount} sugeridas).`);
    } else {
        return this.createExpenseOrRevenueAndStartEditFlow(pendingExpense, analysisResult, userContext, categoryId, selectedCard.id);
    }
    return true;
  }

  async handleNumericReplyForInstallmentCount(groupId, selectedNumber, participantPhone, profileId) {
    const pendingExpense = await PendingExpense.findOne({
      where: { whatsapp_group_id: groupId, participant_phone: participantPhone, profile_id: profileId, action_expected: 'awaiting_installment_count' },
      order: [['createdAt', 'DESC']]
    });
    if (!pendingExpense) return false;

    const installmentCount = parseInt(selectedNumber, 10);
    // Validação extra de segurança do Código 01 (máximo 36 parcelas)
    if (isNaN(installmentCount) || installmentCount <= 0 || installmentCount > 36) return true;

    const analysisResult = {
        value: pendingExpense.value,
        baseDescription: pendingExpense.description,
        categoryName: pendingExpense.suggested_new_category_name,
        flow: 'expense',
        isInstallment: true,
        installmentCount: installmentCount,
        cardName: null,
    };
    const userContext = pendingExpense.description.match(/\(([^)]+)\)/)?.[1] || '';
    return this.createExpenseOrRevenueAndStartEditFlow(pendingExpense, analysisResult, userContext, pendingExpense.suggested_category_id, pendingExpense.credit_card_id);
  }

  async sendSpendingReport(groupId, recipientPhone, profileId) {
      try {
          const now = new Date();
          const filters = { period: 'monthly' };
          const kpis = await dashboardService.getKPIs(filters, profileId);
          const chartData = await dashboardService.getChartData(filters, profileId);
          if (!kpis) return;

          const formattedTotalExpenses = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(kpis.totalExpenses);
          const formattedTotalRevenues = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(kpis.totalRevenues);
          const formattedBalance = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(kpis.balance);

          let expenseCategorySummary = 'Sem gastos.';
          if (chartData.pieChart && chartData.pieChart.length > 0) {
              expenseCategorySummary = chartData.pieChart.sort((a, b) => b.value - a.value).map(cat => `- ${cat.name}: ${new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cat.value)}`).join('\n');
          }
          const reportMessage = `📊 *Relatório Mensal*\n\n💸 Saídas: ${formattedTotalExpenses}\n💰 Entradas: ${formattedTotalRevenues}\n⚖️ Saldo: ${formattedBalance}\n\n*Por Categoria:*\n${expenseCategorySummary}`;
          await whatsappService.sendWhatsappMessage(groupId, reportMessage);
      } catch (error) {
          logger.error('[Webhook] Erro relatório:', error);
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

const runPendingExpenseWorker = async () => {};
WebhookService.runPendingExpenseWorker = runPendingExpenseWorker;

module.exports = new WebhookService();