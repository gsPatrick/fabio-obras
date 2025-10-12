// src/features/WhatsappWebhook/whatsappWebhook.service.js
'use strict';

const logger = require('../../utils/logger');
const { MonitoredGroup, Category, PendingExpense, Expense, Revenue, Profile, User, OnboardingState, MonthlyGoal, CreditCard } = require('../../models');
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

const CONTEXT_WAIT_TIME_MINUTES = 2;
const EXPENSE_EDIT_WAIT_TIME_MINUTES = 5;
const ONBOARDING_WAIT_TIME_MINUTES = 10;
const MENU_COMMAND = 'MENU';

class WebhookService {

  async _findUserByFlexiblePhone(phone) {
    if (!phone) return null;
    const variations = new Set([phone]);
    // Adiciona variações de 8/9 dígitos para DDDs brasileiros
    if (phone.startsWith('55') && phone.length === 12) { // Ex: 552188881111 (8 digitos local)
      const areaCode = phone.substring(2, 4);
      const localNumber = phone.substring(4);
      if (localNumber.length === 8) {
        variations.add(`55${areaCode}9${localNumber}`); // Add 9 na frente: 5521988881111
      }
    } else if (phone.startsWith('55') && phone.length === 13) { // Ex: 5521988881111 (9 digitos local)
      const areaCode = phone.substring(2, 4);
      const localNumber = phone.substring(4);
      if (localNumber.startsWith('9') && localNumber.length === 9) {
        variations.add(`55${areaCode}${localNumber.substring(1)}`); // Remove 9: 552188881111
      }
    } else if (phone.length === 10 || phone.length === 11) { // DDD + Número sem 55
      variations.add(`55${phone}`);
      if (phone.length === 10) { // Ex: 2188881111
        variations.add(`55${phone.substring(0,2)}9${phone.substring(2)}`);
      } else if (phone.length === 11 && phone.startsWith('9', 2)) { // Ex: 21988881111
        variations.add(`55${phone.substring(0,2)}${phone.substring(3)}`);
      }
    }
    logger.info(`[Auth] Buscando usuário com variações de telefone: ${Array.from(variations).join(', ')}`);
    return User.findOne({ where: { whatsapp_phone: { [Op.in]: Array.from(variations) } } });
  }

  async processIncomingMessage(payload) {
    // --- INÍCIO DA CORREÇÃO ---
    // Ignora payloads que não são mensagens recebidas ou criação de grupo
    if (payload.type !== 'ReceivedCallback' && payload.notification !== 'GROUP_CREATE') {
        logger.debug(`[Webhook] Ignorando payload de tipo '${payload.type}'.`);
        return;
    }
    // --- FIM DA CORREÇÃO ---

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
        logger.debug(`[Webhook] Mensagem individual ou grupo não monitorado de ${payload.phone}. Ignorando.`);
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
        logger.debug(`[Webhook] Grupo ${payload.phone} não está sendo monitorado ou participante não está pendente.`);
        return; 
    }

    const groupWithDetails = await MonitoredGroup.findOne({ 
        where: { id: monitoredGroup.id }, 
        include: [{ model: Profile, as: 'profile', include: [{ model: User, as: 'user' }] }] 
    });

    if (!groupWithDetails.profile || !groupWithDetails.profile.user) { 
        logger.error(`[Webhook] Falha crítica: Grupo monitorado ${monitoredGroup.id} não possui perfil ou usuário associado.`); 
        return; 
    }

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
    
    if (payload.buttonsResponseMessage) { 
        return this.handleButtonResponse(payload); 
    }
    
    if (payload.text?.message?.toUpperCase().trim() === MENU_COMMAND) {
        return this.sendMainMenu(payload.phone);
    }

    if (payload.image || payload.document) { 
        return this.handleMediaArrival(payload); 
    }
    
    if (payload.audio || payload.text) { 
        return this.handleContextArrival(payload); 
    }
  }
  
  async sendMainMenu(groupId) {
    const message = `Olá! O que você gostaria de fazer?`;
    const buttons = [
        { id: 'menu_create_expense_revenue', label: '💸 Lançar Despesa/Receita' },
        { id: 'menu_view_report', label: '📊 Ver Relatório Mensal' },
        { id: 'menu_export_excel', label: '📝 Exportar Planilha' },
        { id: 'menu_create_category', label: '➕ Criar Categoria' },
        { id: 'menu_manage_cards', label: '💳 Gerenciar Cartões' },
    ];
    await whatsappService.sendButtonList(groupId, message, buttons);
    logger.info(`[Webhook] Menu principal enviado para ${groupId}.`);
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
    if (!userIsInitiator || (state.user_id && userIsInitiator.id !== state.user_id) || (!state.user_id && payload.participantPhone !== state.initiator_phone)) {
        logger.warn(`[Onboarding] Resposta ignorada. Participante ${payload.participantPhone} não é o iniciador/proprietário do estado de onboarding para o grupo ${groupId}.`);
        await whatsappService.sendWhatsappMessage(groupId, `👋 Olá! Este fluxo de configuração foi iniciado por outra pessoa neste grupo. Por favor, aguarde o processo ser concluído.`);
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
            await whatsappService.sendWhatsappMessage(groupId, 'Qual o nome da nova categoria? (ex: "Elétrica", "Salário")');
        } else if (buttonId === 'onboarding_finish') {
            const finalMessage = `👍 Configuração concluída! Já pode começar a registrar seus custos e receitas.

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
        
        await whatsappService.sendWhatsappMessage(group_id, `✅ Categoria "*${temp_category_name}*" (Tipo: ${temp_category_type}, Fluxo: ${temp_category_flow === 'expense' ? 'Despesa' : 'Receita'}) criada com sucesso!${goalMessage}`);
        
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
    const profileId = payload.profileId;

    if (buttonId.startsWith('menu_')) {
        const action = buttonId.split('_')[1];
        if (action === 'create_expense_revenue') {
             await whatsappService.sendWhatsappMessage(groupId, `Ok! Por favor, me envie a despesa ou receita.\n\nVocê pode mandar o texto (ex: "R$ 500 Aluguel", ou "Salário 3000"), um áudio ou um comprovante.`);
        } else if (action === 'view_report') {
            await this.sendSpendingReport(groupId, payload.participantPhone, profileId);
        } else if (action === 'export_excel') {
            await this.sendExpensesExcelReport(groupId, payload.participantPhone, profileId);
        } else if (action === 'create_category') {
             // === MUDANÇAS AQUI ===
             // Substitui o status ENUM por 'action_expected' como string
             const pending = await PendingExpense.create({ 
                whatsapp_message_id: payload.messageId + '_menu_cat',
                whatsapp_group_id: groupId,
                participant_phone: payload.participantPhone,
                profile_id: profileId,
                action_expected: 'awaiting_new_category_name', // NOVO CAMPO
                expires_at: new Date(Date.now() + EXPENSE_EDIT_WAIT_TIME_MINUTES * 60 * 1000),
             });
             await whatsappService.sendWhatsappMessage(groupId, 'Qual o nome da nova categoria? (ex: "Elétrica", "Salário")');
        } else if (action === 'manage_cards') {
            return this.handleManageCardsAction(groupId, payload.participantPhone, profileId, payload.messageId);
        }
        return;
    }

    if (buttonId.startsWith('edit_expense_')) {
      return this.handleEditButtonFlow(payload);
    }
    
    if (buttonId.startsWith('new_cat_')) {
      return this.handleNewCategoryDecisionFlow(payload);
    }
    
    if (buttonId.startsWith('new_cat_flow_')) {
        return this.handleNewCategoryFlowDecision(payload);
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
    logger.info(`[Webhook] Menu de gerenciamento de cartões enviado para ${groupId}.`);
  }

  async handleCreditCardButtonResponse(payload) {
    const buttonId = payload.buttonsResponseMessage.buttonId;
    const groupId = payload.phone;
    const profileId = payload.profileId;
    const participantPhone = payload.participantPhone;
    const messageId = buttonId.split('_')[2];

    if (buttonId.startsWith('card_create_')) {
        // === MUDANÇAS AQUI ===
        // Limpa PendingExpenses antigos para este fluxo de criação de cartão
        await PendingExpense.destroy({ 
            where: { 
                participant_phone: participantPhone, 
                whatsapp_group_id: groupId, 
                profile_id: profileId, 
                action_expected: { 
                    [Op.in]: ['awaiting_new_card_name', 'awaiting_new_card_closing_day', 'awaiting_new_card_due_day', 'awaiting_card_creation_confirmation'] 
                } 
            } 
        });

        const pending = await PendingExpense.create({
            whatsapp_message_id: messageId,
            whatsapp_group_id: groupId,
            participant_phone: participantPhone,
            profile_id: profileId,
            action_expected: 'awaiting_new_card_name', // NOVO CAMPO
            expires_at: new Date(Date.now() + EXPENSE_EDIT_WAIT_TIME_MINUTES * 60 * 1000),
        });
        await whatsappService.sendWhatsappMessage(groupId, `Ok! Qual será o *nome* do novo cartão? (ex: "Nubank", "Cartão da Obra")`);
    } else if (buttonId.startsWith('card_confirm_create_')) {
        const pendingExpenseId = buttonId.split('_')[3];
        const pending = await PendingExpense.findByPk(pendingExpenseId, { where: { profile_id: profileId } });

        // === MUDANÇAS AQUI ===
        // Verifica action_expected
        if (!pending || pending.action_expected !== 'awaiting_card_creation_confirmation') {
            await whatsappService.sendWhatsappMessage(groupId, `⏳ O tempo para esta decisão expirou ou o fluxo foi interrompido.`);
            if (pending) await pending.destroy();
            return;
        }

        try {
            // Os dados temporários para o cartão (temp_card_name, temp_card_closing_day, temp_card_due_day)
            // precisam ter sido salvos diretamente no PendingExpense, pois removemos os campos temp_ai_parsed_*.
            // Vamos assumir que eles estão lá, ou você precisaria adaptar a IA para colocar direto no PendingExpense
            // ou readaptar o PendingExpense para ter campos específicos para o fluxo de criação de cartão
            const newCard = await creditCardService.createCreditCard(pending.profile_id, {
                name: pending.suggested_new_category_name, // Reutilizando campo para o nome do cartão
                closing_day: pending.value, // Reutilizando campo para o dia de fechamento
                due_day: pending.description, // Reutilizando campo para o dia de vencimento
                last_four_digits: null, 
            });
            await whatsappService.sendWhatsappMessage(groupId, `✅ Cartão "*${newCard.name}*" criado com sucesso!\n\nFechamento: dia ${newCard.closing_day}\nVencimento: dia ${newCard.due_day}.`);
            await pending.destroy();
            await this.sendMainMenu(groupId);
        } catch (error) {
            logger.error('[Webhook] Erro ao criar cartão de crédito (confirmação):', error);
            await whatsappService.sendWhatsappMessage(groupId, `❌ Ocorreu um erro ao criar o cartão. ${error.message}`);
            await pending.destroy();
            await this.sendMainMenu(groupId);
        }

    } else if (buttonId.startsWith('card_cancel_create_')) {
        const pendingExpenseId = buttonId.split('_')[3];
        const pending = await PendingExpense.findByPk(pendingExpenseId, { where: { profile_id: profileId } });
        if (pending) await pending.destroy();
        await whatsappService.sendWhatsappMessage(groupId, `Criação de cartão cancelada.`);
        await this.sendMainMenu(groupId);
    } else if (buttonId.startsWith('menu_back_to_main_')) {
        return this.sendMainMenu(groupId);
    }
  }

  // === MUDANÇAS AQUI ===
  // Adaptando o fluxo de criação de cartão sem os campos temp_card_* e sem ENUM
  async handleCreditCardCreationFlowFromPending(payload, pending) {
    const groupId = payload.phone;
    const textMessage = payload.text?.message;

    switch (pending.action_expected) { // Usa action_expected
        case 'awaiting_new_card_name':
            if (textMessage) {
                // Armazenando o nome no campo 'suggested_new_category_name' (reutilização)
                pending.suggested_new_category_name = textMessage.trim(); 
                pending.action_expected = 'awaiting_new_card_closing_day';
                await pending.save();
                await whatsappService.sendWhatsappMessage(groupId, `Certo, o nome será "*${pending.suggested_new_category_name}*".\n\nAgora, qual o *dia de fechamento da fatura*? (Responda apenas com o número do dia, de 1 a 31. Ex: 10)`);
            } else {
                await whatsappService.sendWhatsappMessage(groupId, `Por favor, me diga o nome do cartão.`);
            }
            break;
        case 'awaiting_new_card_closing_day':
            if (textMessage && /^\d+$/.test(textMessage)) {
                const day = parseInt(textMessage, 10);
                if (day >= 1 && day <= 31) {
                    // Armazenando o dia de fechamento no campo 'value' (reutilização)
                    pending.value = day; 
                    pending.action_expected = 'awaiting_new_card_due_day';
                    await pending.save();
                    await whatsappService.sendWhatsappMessage(groupId, `Dia de fechamento definido para o dia *${day}*.\n\nE qual o *dia de vencimento da fatura*? (Responda apenas com o número do dia, de 1 a 31. Ex: 20)`);
                } else {
                    await whatsappService.sendWhatsappMessage(groupId, `Dia inválido. Por favor, responda com um número entre 1 e 31.`);
                }
            } else {
                await whatsappService.sendWhatsappMessage(groupId, `Por favor, responda com o dia de fechamento (número).`);
            }
            break;
        case 'awaiting_new_card_due_day':
            if (textMessage && /^\d+$/.test(textMessage)) {
                const day = parseInt(textMessage, 10);
                if (day >= 1 && day <= 31) {
                    // Armazenando o dia de vencimento no campo 'description' (reutilização)
                    pending.description = day; 
                    // NÃO CHAMA SAVE AQUI, pois a criação do cartão já vai destruir o pending
                    // await pending.save();

                    try {
                        const newCard = await creditCardService.createCreditCard(pending.profile_id, {
                            name: pending.suggested_new_category_name,
                            closing_day: pending.value,
                            due_day: pending.description,
                            last_four_digits: null,
                        });
                        await whatsappService.sendWhatsappMessage(groupId, `✅ Cartão "*${newCard.name}*" criado com sucesso!\n\nFechamento: dia ${newCard.closing_day}\nVencimento: dia ${newCard.due_day}.`);
                        await pending.destroy();
                        await this.sendMainMenu(groupId);
                    } catch (error) {
                        logger.error('[Webhook] Erro ao criar cartão de crédito:', error);
                        await whatsappService.sendWhatsappMessage(groupId, `❌ Ocorreu um erro ao criar o cartão. ${error.message}`);
                        await pending.destroy();
                        await this.sendMainMenu(groupId);
                    }
                } else {
                    await whatsappService.sendWhatsappMessage(groupId, `Dia inválido. Por favor, responda com um número entre 1 e 31.`);
                }
            } else {
                await whatsappService.sendWhatsappMessage(groupId, `Por favor, responda com o dia de vencimento (número).`);
            }
            break;
    }
  }
  // === FIM MUDANÇAS AQUI ===


  async handleMediaArrival(payload) {
    if (payload.fromMe) return;
    const groupId = payload.phone;
    const participantPhone = payload.participantPhone;
    const profileId = payload.profileId;
    const mediaUrl = payload.image ? payload.image.imageUrl : payload.document.documentUrl;
    const mimeType = payload.image ? payload.image.mimeType : payload.document.mimeType;
    
    // === MUDANÇAS AQUI ===
    // Limpa PendingExpenses antigos para este participant/group/profile
    await PendingExpense.destroy({ 
        where: { 
            participant_phone: participantPhone, 
            whatsapp_group_id: groupId, 
            profile_id: profileId,
            // AQUI, como não temos 'status' ENUM, removemos a condição 'status: { [Op.in]: [...] }'
            // Assumimos que qualquer PendingExpense para este usuário/grupo significa um fluxo em andamento
        } 
    });
    
    const pending = await PendingExpense.create({
      whatsapp_message_id: payload.messageId,
      whatsapp_group_id: groupId,
      participant_phone: participantPhone,
      attachment_url: mediaUrl,
      attachment_mimetype: mimeType,
      action_expected: 'awaiting_context', // NOVO CAMPO
      profile_id: profileId,
      expires_at: new Date(Date.now() + CONTEXT_WAIT_TIME_MINUTES * 60 * 1000),
    });
    const confirmationMessage = `📄 Recebi o documento. Qual a descrição para ele? (ex: "500 aluguel" ou "salário de 1000")`;
    await whatsappService.sendWhatsappMessage(groupId, confirmationMessage);
    logger.info(`[Webhook] Mídia (${mimeType}) de ${participantPhone} recebida. Mensagem de confirmação enviada.`);
  }

  async handleContextArrival(payload) {
    if (payload.fromMe) { return; }
    const groupId = payload.phone;
    const participantPhone = payload.participantPhone;
    const profileId = payload.profileId;
    const textMessage = payload.text ? payload.text.message : null;
    const audioUrl = payload.audio ? payload.audio.audioUrl : null;

    if (!profileId) {
        logger.warn(`[Webhook] ProfileId não encontrado para o grupo ${groupId}. Ignorando contexto.`);
        return;
    }

    // --- Tratamento de Comandos Específicos ---
    if (textMessage && textMessage.toLowerCase().trim() === '#relatorio') {
        return this.sendSpendingReport(groupId, participantPhone, profileId);
    }
    if (textMessage && textMessage.toLowerCase().trim() === '#exportardespesas') {
        return this.sendExpensesExcelReport(groupId, participantPhone, profileId);
    }
    if (textMessage && textMessage.toLowerCase().trim() === MENU_COMMAND) {
        return this.sendMainMenu(groupId);
    }
    
    // <<< INÍCIO DA CORREÇÃO: Mover a checagem de resposta numérica para cima >>>
    if (textMessage && /^\d+$/.test(textMessage)) {
        // A função handleNumericReply retorna true se conseguiu lidar com o número, ou false se não encontrou um fluxo pendente.
        const handled = await this.handleNumericReply(groupId, parseInt(textMessage, 10), participantPhone, profileId);
        // Se foi tratado (era uma resposta para uma lista), interrompe o processamento aqui.
        if (handled) return;
    }
    // <<< FIM DA CORREÇÃO >>>

    const pendingFlow = await PendingExpense.findOne({
        where: { 
            participant_phone: participantPhone, 
            whatsapp_group_id: groupId, 
            profile_id: profileId, 
            action_expected: { 
                [Op.in]: [
                    'awaiting_new_category_name', 'awaiting_new_category_type', 'awaiting_category_flow_decision', 'awaiting_new_category_goal',
                    'awaiting_new_card_name', 'awaiting_new_card_closing_day', 'awaiting_new_card_due_day', 'awaiting_card_creation_confirmation'
                ] 
            }
        },
        order: [['createdAt', 'DESC']]
    });

    if (pendingFlow) {
        if (['awaiting_new_category_name', 'awaiting_new_category_type', 'awaiting_category_flow_decision', 'awaiting_new_category_goal'].includes(pendingFlow.action_expected)) {
            return this.handleNewCategoryCreationFlowFromPending(payload, pendingFlow);
        }
        if (['awaiting_new_card_name', 'awaiting_new_card_closing_day', 'awaiting_new_card_due_day', 'awaiting_card_creation_confirmation'].includes(pendingFlow.action_expected)) {
            return this.handleCreditCardCreationFlowFromPending(payload, pendingFlow);
        }
    }

    // --- Continuação de Fluxos de Despesa/Receita (com mídia) ---
    const pendingMedia = await PendingExpense.findOne({
      where: { 
          participant_phone: participantPhone, 
          whatsapp_group_id: groupId, 
          profile_id: profileId, 
          action_expected: 'awaiting_context',
          expires_at: { [Op.gt]: new Date() } 
      },
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
      
      await whatsappService.sendWhatsappMessage(groupId, `🤖 Analisando documento e sua descrição...`);
      let userContext = '';
      if (audioUrl) {
        const audioBuffer = await whatsappService.downloadZapiMedia(audioUrl);
        userContext = audioBuffer ? await aiService.transcribeAudio(audioBuffer) : '';
      } else if (textMessage) {
        userContext = textMessage;
      }
      
      const mediaBuffer = await whatsappService.downloadZapiMedia(pendingMedia.attachment_url);
      if (mediaBuffer && userContext) {
        const analysisResult = await aiService.analyzeExpenseWithImage(mediaBuffer, userContext, pendingMedia.attachment_mimetype, pendingMedia.profile_id);
        if (analysisResult) {
          return this.decideAndSaveExpenseOrRevenue(pendingMedia, analysisResult, userContext);
        } else {
          await whatsappService.sendWhatsappMessage(groupId, `❌ Desculpe, não consegui analisar o documento e o texto/áudio. Tente enviar novamente.`);
          await pendingMedia.destroy();
        }
      } else {
        await whatsappService.sendWhatsappMessage(groupId, `❌ Ocorreu um erro ao processar o arquivo ou o áudio. Por favor, tente novamente.`);
        await pendingMedia.destroy();
      }
    } else if (textMessage || audioUrl) {
        await whatsappService.sendWhatsappMessage(groupId, `🤖 Analisando sua mensagem...`);
        let userContext = '';
        if (audioUrl) {
          const audioBuffer = await whatsappService.downloadZapiMedia(audioUrl);
          userContext = audioBuffer ? await aiService.transcribeAudio(audioBuffer) : '';
        } else {
          userContext = textMessage;
        }

        if (userContext) {
            await PendingExpense.destroy({ 
                where: { 
                    participant_phone: participantPhone, 
                    whatsapp_group_id: groupId, 
                    profile_id: profileId,
                } 
            });

            const tempPending = await PendingExpense.create({
                whatsapp_message_id: payload.messageId,
                whatsapp_group_id: groupId,
                participant_phone: participantPhone,
                profile_id: profileId,
                action_expected: 'awaiting_ai_analysis_complete',
                expires_at: new Date(Date.now() + CONTEXT_WAIT_TIME_MINUTES * 60 * 1000),
            });

            const analysisResult = await aiService.analyzeTextForExpenseOrRevenue(userContext, profileId);
            
            if (analysisResult && (analysisResult.value !== null || (analysisResult.cardName && analysisResult.closingDay && analysisResult.dueDay))) {
                if (analysisResult.cardName && analysisResult.closingDay && analysisResult.dueDay && analysisResult.value === null) {
                    tempPending.suggested_new_category_name = analysisResult.cardName;
                    tempPending.value = analysisResult.closingDay;
                    tempPending.description = analysisResult.dueDay;
                    tempPending.action_expected = 'awaiting_card_creation_confirmation';
                    await tempPending.save();

                    await whatsappService.sendWhatsappMessage(groupId, `A IA identificou um pedido para criar o cartão "*${analysisResult.cardName}*" com fechamento dia *${analysisResult.closingDay}* e vencimento dia *${analysisResult.dueDay}*. Confirma?`);
                    const buttons = [
                        { id: `card_confirm_create_${tempPending.id}`, label: '✅ Criar Cartão' },
                        { id: `card_cancel_create_${tempPending.id}`, label: '❌ Cancelar' },
                    ];
                    await whatsappService.sendButtonList(groupId, null, buttons);
                    return;
                }
                
                if (analysisResult.value !== null) {
                   return this.decideAndSaveExpenseOrRevenue(tempPending, analysisResult, userContext);
                }
            }
            
            await whatsappService.sendWhatsappMessage(groupId, `❌ Desculpe, não consegui entender o valor, a descrição, a categoria ou um comando de cartão da sua mensagem. Por favor, tente novamente de forma mais clara (ex: "500 aluguel" ou "Salário 3000 categoria salário" ou "criar cartão Visa fechamento dia 5 vencimento dia 15").`);
            await tempPending.destroy();

        } else {
            await whatsappService.sendWhatsappMessage(groupId, `❌ Ocorreu um erro ao processar o áudio/texto. Por favor, tente novamente.`);
            await PendingExpense.destroy({ 
                where: { 
                    participant_phone: participantPhone, 
                    whatsapp_group_id: groupId, 
                    profile_id: profileId,
                } 
            });
        }
    }
  }

  async decideAndSaveExpenseOrRevenue(pendingData, analysisResult, userContext) {
    const { categoryName, flow, value, baseDescription, isInstallment, installmentCount, cardName } = analysisResult;
    const profileId = pendingData.profile_id;
    const groupId = pendingData.whatsapp_group_id;

    let category = await Category.findOne({ 
        where: { name: categoryName, profile_id: profileId, category_flow: flow } 
    });
    
    if (flow && !category) {
        category = await Category.findOne({ where: { name: categoryName, profile_id: profileId } });
    }

    if (category) {
        if (category.category_flow === 'expense' && (isInstallment || cardName)) {
            // === MUDANÇAS AQUI ===
            // Armazena os dados da análise da IA diretamente no PendingExpense, reutilizando campos
            pendingData.value = value;
            pendingData.description = baseDescription;
            pendingData.suggested_new_category_name = categoryName; // Reutilizando para o nome da categoria que a IA encontrou
            pendingData.suggested_category_flow = flow;
            pendingData.installment_count = isInstallment ? installmentCount : null;
            // Para cardName, vamos usar um campo mais genérico no pending, ou assumir que a IA não precisará mais dele após esta etapa.
            // Por simplicidade aqui, não vou adicionar um campo novo específico para cardName na PendingExpense.
            pendingData.action_expected = 'awaiting_credit_card_choice'; // NOVO CAMPO
            pendingData.suggested_category_id = category.id; // Salva o ID da categoria encontrada
            pendingData.expires_at = new Date(Date.now() + EXPENSE_EDIT_WAIT_TIME_MINUTES * 60 * 1000);
            await pendingData.save();

            const creditCards = await creditCardService.getAllCreditCards(profileId);
            if (creditCards.length > 0) {
                const cardListText = creditCards.map((card, index) => `${index + 1} - ${card.name} (final ${card.last_four_digits || 'N/A'})`).join('\n');
                let cardMessage = `ℹ️ A despesa de *${new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value)}* na categoria *${category.name}* pode ser de cartão.\n\nSelecione o *número* do cartão para registrar ou responda *0* para registrar como dinheiro/débito.\n\n${cardListText}`;
                
                if (cardName) {
                    const suggestedCard = creditCards.find(c => c.name.toLowerCase() === cardName.toLowerCase());
                    if (suggestedCard) {
                        cardMessage = `ℹ️ A IA sugeriu o cartão *${suggestedCard.name}* para a despesa de *${new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value)}* na categoria *${category.name}*.\n\nConfirma? Responda com o *número* do cartão ou *0* para dinheiro/débito.\n\n${cardListText}`;
                    }
                }
                await whatsappService.sendWhatsappMessage(groupId, cardMessage);
                logger.info(`[Webhook] Despesa de cartão/parcelada. Aguardando escolha de cartão para pendência #${pendingData.id}.`);
                return;
            } else {
                await whatsappService.sendWhatsappMessage(groupId, `ℹ️ Despesa de *${new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value)}* na categoria *${category.name}*.\n\nNão há cartões de crédito cadastrados para este perfil. Será registrada como dinheiro/débito. ${isInstallment ? 'Para parcelar, você precisa de um cartão cadastrado.' : ''}`);
                return this.createExpenseOrRevenueAndStartEditFlow(pendingData, analysisResult, userContext, category.id, null);
            }

        } else if (category.category_flow === 'revenue' && (isInstallment || cardName)) {
            await whatsappService.sendWhatsappMessage(groupId, `⚠️ A categoria "${category.name}" é de *Receita*. A informação de cartão/parcelamento será ignorada.`);
            return this.createExpenseOrRevenueAndStartEditFlow(pendingData, analysisResult, userContext, category.id, null);
        }
        else {
            return this.createExpenseOrRevenueAndStartEditFlow(pendingData, analysisResult, userContext, category.id, null);
        }
    }

    // === MUDANÇAS AQUI ===
    // Armazena os dados da análise da IA diretamente no PendingExpense, reutilizando campos
    pendingData.value = value;
    pendingData.description = userContext ? `${baseDescription} (${userContext})` : baseDescription; // Descrição final para o PendingExpense
    pendingData.suggested_new_category_name = categoryName;
    pendingData.suggested_category_flow = flow;
    pendingData.action_expected = 'awaiting_new_category_decision'; // NOVO CAMPO
    pendingData.expires_at = new Date(Date.now() + EXPENSE_EDIT_WAIT_TIME_MINUTES * 60 * 1000);
    await pendingData.save();

    const message = `🤔 A categoria que identifiquei, "*${categoryName}*", parece ser nova para este perfil (${flow === 'expense' ? 'Despesa' : 'Receita'}). O que você gostaria de fazer?`;
    const buttons = [ 
        { id: `new_cat_create_${pendingData.id}`, label: '✅ Criar e Usar' }, 
        { id: `new_cat_choose_${pendingData.id}`, label: '📋 Escolher da Lista Existente' }, 
        { id: `new_cat_outros_${pendingData.id}`, label: `➡️ Usar "${flow === 'expense' ? 'Outros' : 'Receita Padrão'}"` }, 
    ];
    await whatsappService.sendButtonList(groupId, message, buttons);
    logger.info(`[Webhook] Nova categoria "${categoryName}" sugerida. Aguardando decisão do usuário para pendência #${pendingData.id}.`);
  }

  async createExpenseOrRevenueAndStartEditFlow(pendingData, analysisResult, userContext, categoryId, creditCardId = null) {
    const { value, baseDescription, flow, isInstallment, installmentCount, cardName } = analysisResult;
    const finalDescriptionForDB = userContext ? `${baseDescription} (${userContext})` : baseDescription;
    
    const category = await Category.findByPk(categoryId);
    if (!category) {
        await whatsappService.sendWhatsappMessage(pendingData.whatsapp_group_id, `❌ Erro: Categoria não encontrada no momento do registro final. Por favor, tente novamente ou crie a categoria primeiro.`);
        await pendingData.destroy();
        return;
    }

    let createdEntry;
    const entryDate = new Date();
    let chargeDate = null;

    if (creditCardId) {
        const creditCard = await CreditCard.findByPk(creditCardId);
        if (creditCard) {
            const currentMonth = getMonth(entryDate);
            const currentYear = getYear(entryDate);
            
            let invoiceMonth = currentMonth;
            let invoiceYear = currentYear;
            
            if (entryDate.getDate() > creditCard.closing_day) {
                invoiceMonth = (currentMonth + 1) % 12;
                if (invoiceMonth === 0) invoiceYear += 1;
            }
            
            chargeDate = new Date(invoiceYear, invoiceMonth, creditCard.due_day);
            chargeDate.setHours(0, 0, 0, 0); 
        }
    }

    if (category.category_flow === 'expense') {
        const expenseToCreate = {
            value: value,
            description: finalDescriptionForDB,
            expense_date: entryDate,
            whatsapp_message_id: pendingData.whatsapp_message_id,
            category_id: categoryId,
            profile_id: pendingData.profile_id,
            credit_card_id: creditCardId,
            is_installment: isInstallment,
            total_installments: isInstallment ? installmentCount : null,
            current_installment_number: isInstallment ? 1 : null,
            installment_total_value: isInstallment ? (value * installmentCount) : null,
            charge_date: chargeDate,
        };
        createdEntry = await Expense.create(expenseToCreate);

        if (isInstallment && installmentCount > 1) {
            for (let i = 2; i <= installmentCount; i++) {
                let nextChargeDate = new Date(chargeDate);
                nextChargeDate.setMonth(nextChargeDate.getMonth() + (i - 1));
                
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
            value: value,
            description: finalDescriptionForDB,
            revenue_date: entryDate,
            whatsapp_message_id: pendingData.whatsapp_message_id,
            category_id: categoryId,
            profile_id: pendingData.profile_id,
        });
    }

    pendingData.expense_id = createdEntry instanceof Expense ? createdEntry.id : null;
    pendingData.revenue_id = createdEntry instanceof Revenue ? createdEntry.id : null;
    
    pendingData.suggested_category_id = categoryId;
    pendingData.credit_card_id = creditCardId;
    // === MUDANÇAS AQUI ===
    pendingData.action_expected = 'awaiting_validation'; // NOVO CAMPO
    pendingData.expires_at = new Date(Date.now() + EXPENSE_EDIT_WAIT_TIME_MINUTES * 60 * 1000); 
    await pendingData.save();

    const formattedValue = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
    
    let message = '';
    if (category.category_flow === 'expense') {
        const totalExpenses = await Expense.sum('value', { where: { profile_id: pendingData.profile_id, original_expense_id: { [Op.eq]: null } } });
        const formattedTotalExpenses = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(totalExpenses || 0);
        
        let installmentInfo = '';
        if (isInstallment) {
            installmentInfo = `\n*Parcelas:* ${analysisResult.installmentCount}x de ${formattedValue} (Total: ${new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value * installmentCount)})` +
                              (creditCardId ? `\n*Cartão:* ${(await CreditCard.findByPk(creditCardId))?.name || 'N/A'}` : '');
        } else if (creditCardId) {
            installmentInfo = `\n*Cartão:* ${(await CreditCard.findByPk(creditCardId))?.name || 'N/A'}`;
        }

        message = `💸 *Despesa Registrada:* ${formattedValue}\n*Categoria:* ${category.name}\n*Desc.:* ${baseDescription}${installmentInfo}\n*Total de Despesas:* ${formattedTotalExpenses}`;
        
        const now = new Date();
        const startOfCurrentMonth = startOfMonth(now);
        const endOfCurrentMonth = new Date();
        
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
        if (categoryGoal && currentMonthTotalExpenses) {
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
                message += `\n\n🚨 *ALERTA:* Você excedeu a meta de *${new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(categoryGoal.value)}* para a categoria *${category.name}* neste mês!`;
            } else {
                const remaining = parseFloat(categoryGoal.value) - currentCategoryExpenses;
                message += `\n*Meta Categoria ${category.name}:* ${new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(remaining)} restantes.`;
            }
        }
        
        const totalGoal = await MonthlyGoal.findOne({ where: { profile_id: pendingData.profile_id, is_total_goal: true, category_id: null } });
        if (totalGoal && currentMonthTotalExpenses) {
             if (currentMonthTotalExpenses > parseFloat(totalGoal.value)) {
                message += `\n🚨 *ALERTA GERAL:* Você excedeu a meta total de *${new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(totalGoal.value)}* neste mês!`;
             } else {
                const remaining = parseFloat(totalGoal.value) - currentMonthTotalExpenses;
                message += `\n*Meta Total Mensal:* ${new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(remaining)} restantes.`;
             }
        }

        message += `\n\nDespesa *já* salva! Para alterar a categoria, clique em *Corrigir*.`;

    } else {
        const totalRevenues = await Revenue.sum('value', { where: { profile_id: pendingData.profile_id } });
        const formattedTotalRevenues = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(totalRevenues || 0);
        message = `💰 *Receita Registrada:* ${formattedValue}\n*Categoria:* ${category.name}\n*Desc.:* ${baseDescription}\n*Total de Receitas:* ${formattedTotalRevenues}\n\nReceita *já* salva! Para alterar a categoria, clique em *Corrigir*.`;
    }

    const buttons = [{ id: `edit_expense_${pendingData.id}`, label: '✏️ Corrigir Categoria' }];
    await whatsappService.sendButtonList(pendingData.whatsapp_group_id, message, buttons);
    logger.info(`[Webhook] ${category.category_flow === 'expense' ? 'Despesa' : 'Receita'} #${createdEntry.id} salva e fluxo de edição iniciado para ${pendingData.participant_phone}.`);
  }

  // === MUDANÇAS AQUI ===
  // Adaptando o fluxo de criação de nova categoria
  async handleNewCategoryDecisionFlow(payload) {
    const buttonId = payload.buttonsResponseMessage.buttonId;
    const parts = buttonId.split('_');
    const action = parts[2];
    const pendingExpenseId = parts[3];
    const groupId = payload.phone;
    const profileId = payload.profileId;

    const pendingExpense = await PendingExpense.findByPk(pendingExpenseId, { where: { profile_id: profileId } });
    if (!pendingExpense) { await whatsappService.sendWhatsappMessage(groupId, `⏳ O tempo para esta decisão expirou.`); return; }

    const suggestedFlow = pendingExpense.suggested_category_flow || 'expense';
    const otherCategoryName = suggestedFlow === 'expense' ? 'Outros' : 'Receita Padrão';

    if (action === 'create') {
        // === MUDANÇAS AQUI ===
        pendingExpense.action_expected = 'awaiting_new_category_type'; // NOVO CAMPO
        await pendingExpense.save();
        await whatsappService.sendWhatsappMessage(groupId, `Entendido! A qual tipo de custo/receita a categoria "*${pendingExpense.suggested_new_category_name}*" pertence?\n\nResponda com um tipo (ex: "Material", "Mão de Obra", "Salário", "Serviço Avulso").`);
    } else if (action === 'choose') {
        payload.buttonsResponseMessage.buttonId = `edit_expense_${pendingExpenseId}`;
        await this.handleEditButtonFlow(payload);
    } else if (action === 'outros') {
        const finalCategory = await Category.findOne({ 
            where: { 
                name: otherCategoryName, 
                profile_id: profileId, 
                category_flow: suggestedFlow 
            } 
        });

        if (!finalCategory) { 
            await whatsappService.sendWhatsappMessage(groupId, `❌ Erro crítico: A categoria "${otherCategoryName}" não foi encontrada para este perfil com o fluxo ${suggestedFlow}.`); 
            return; 
        }
        
        // === MUDANÇAS AQUI ===
        // Reconstruindo o analysisResult a partir dos dados no pendingExpense
        const analysisResult = {
            value: pendingExpense.value,
            baseDescription: pendingExpense.description, // Já é a descrição final com contexto
            categoryName: finalCategory.name,
            flow: finalCategory.category_flow,
            isInstallment: pendingExpense.installment_count ? true : false,
            installmentCount: pendingExpense.installment_count,
            cardName: null, // Não temos o cardName salvo no pending se chegou aqui
        };
        const userContext = pendingExpense.description.match(/\(([^)]+)\)/)?.[1] || '';
        await this.createExpenseOrRevenueAndStartEditFlow(pendingExpense, analysisResult, userContext, finalCategory.id);
    }
  }
  
  // === MUDANÇAS AQUI ===
  // Adaptando o fluxo de decisão de categoria (expense/revenue)
  async handleNewCategoryFlowDecision(payload) {
    const buttonId = payload.buttonsResponseMessage.buttonId;
    const parts = buttonId.split('_');
    const flow = parts[3];
    const pendingExpenseId = parts[4];
    const groupId = payload.phone;
    const profileId = payload.profileId;

    const pendingExpense = await PendingExpense.findByPk(pendingExpenseId, { where: { profile_id: profileId } });
    if (!pendingExpense) { await whatsappService.sendWhatsappMessage(groupId, `⏳ O tempo para esta decisão expirou.`); return; }
    
    pendingExpense.suggested_category_flow = flow;
    if (flow === 'expense') {
        // === MUDANÇAS AQUI ===
        pendingExpense.action_expected = 'awaiting_new_category_goal'; // NOVO CAMPO
        await pendingExpense.save();
        await whatsappService.sendWhatsappMessage(groupId, `Qual a *meta mensal de gastos* para a categoria "*${pendingExpense.suggested_new_category_name}*" (Despesa)?\n\nResponda apenas com o número (ex: 1500).\n\nSe não quiser definir uma meta, responda com *0*.`);
    } else {
        await this.finalizeNewCategoryCreationFromPendingExpenseDecision(pendingExpense);
    }
  }

  // === MUDANÇAS AQUI ===
  // Adaptando o fluxo de criação de nova categoria
  async finalizeNewCategoryCreationFromPendingExpenseDecision(pendingExpense, goalValue = 0) {
    const { whatsapp_group_id, profile_id, suggested_new_category_name, suggested_category_flow } = pendingExpense;
    
    // O campo `temp_category_type` agora estará em `pendingExpense.description` (reutilizado)
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

        // === MUDANÇAS AQUI ===
        // Reconstruindo o analysisResult a partir dos dados no pendingExpense
        const analysisResult = {
            value: pendingExpense.value,
            baseDescription: pendingExpense.description, // Já é a descrição final
            categoryName: newCategory.name,
            flow: newCategory.category_flow,
            isInstallment: pendingExpense.installment_count ? true : false,
            installmentCount: pendingExpense.installment_count,
            cardName: null, // Não temos o cardName salvo no pending se chegou aqui
        };
        const userContext = pendingExpense.description.match(/\(([^)]+)\)/)?.[1] || ''; // Tenta extrair contexto original se estiver entre parênteses
        await this.createExpenseOrRevenueAndStartEditFlow(pendingExpense, analysisResult, userContext, newCategory.id, pendingExpense.credit_card_id);

    } catch (error) {
        logger.error('[Webhook] Erro ao finalizar criação de categoria a partir de PendingExpense:', error);
        await whatsappService.sendWhatsappMessage(whatsapp_group_id, `❌ Houve um erro ao criar a categoria "${suggested_new_category_name}". ${error.message}`);
        await pendingExpense.destroy();
    }
  }
  
  // === MUDANÇAS AQUI ===
  // Handle da criação de categoria avulsa do menu
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
                // Armazenando o tipo no campo 'description' do PendingExpense
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
                    await whatsappService.sendWhatsappMessage(groupId, `Qual a *meta mensal de gastos* para a categoria "*${pending.suggested_new_category_name}*" (Despesa)?\n\nResponda apenas com o número (ex: 1500).\n\nSe não quiser definir uma meta, responda com *0*.`);
                } else {
                    await this.finalizeNewCategoryCreationFromPendingExpenseDecision(pending);
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
                await this.finalizeNewCategoryCreationFromPendingExpenseDecision(pending, goalValue);
            }
            break;
    }
  }


  async handleNumericReplyForCreditCard(groupId, selectedNumber, participantPhone, profileId) {
    const pendingExpense = await PendingExpense.findOne({
      where: { whatsapp_group_id: groupId, participant_phone: participantPhone, profile_id: profileId, action_expected: 'awaiting_credit_card_choice' },
      order: [['createdAt', 'DESC']]
    });

    if (!pendingExpense) { 
        logger.warn(`[Webhook] Resposta numérica de ${participantPhone} para cartão ignorada.`); 
        return false; 
    }

    // === MUDANÇAS AQUI ===
    // Reconstruindo o analysisResult a partir dos dados no pendingExpense
    const analysisResult = {
        value: pendingExpense.value,
        baseDescription: pendingExpense.description,
        categoryName: pendingExpense.suggested_new_category_name, // Nome da categoria guardado aqui
        flow: pendingExpense.suggested_category_flow,
        isInstallment: pendingExpense.installment_count ? true : false,
        installmentCount: pendingExpense.installment_count,
        cardName: null, // Não temos o cardName salvo no pending
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
        await whatsappService.sendWhatsappMessage(groupId, `⚠️ *Opção Inválida!* \n\nO número *${selectedNumber}* não corresponde a um cartão. Responda com um número da lista ou *0* para dinheiro/débito.`);
        return true;
    }

    pendingExpense.credit_card_id = selectedCard.id;
    if (analysisResult.isInstallment && analysisResult.installmentCount > 1) {
        // === MUDANÇAS AQUI ===
        pendingExpense.action_expected = 'awaiting_installment_count'; // NOVO CAMPO
        await pendingExpense.save();
        await whatsappService.sendWhatsappMessage(groupId, `Em quantas parcelas (total) esta despesa de *${new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(analysisResult.value)}* será feita no cartão *${selectedCard.name}*? (Responda apenas com o número, ex: 3)`);
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

    if (!pendingExpense) { 
        logger.warn(`[Webhook] Resposta numérica de ${participantPhone} para parcelas ignorada.`); 
        return false; 
    }

    const installmentCount = parseInt(selectedNumber, 10);
    if (isNaN(installmentCount) || installmentCount <= 0 || installmentCount > 36) {
        await whatsappService.sendWhatsappMessage(groupId, `⚠️ *Número de Parcelas Inválido!* \n\nPor favor, responda com um número de parcelas válido (entre 1 e 36).`);
        return true;
    }

    // === MUDANÇAS AQUI ===
    // Reconstruindo o analysisResult a partir dos dados no pendingExpense
    const analysisResult = {
        value: pendingExpense.value,
        baseDescription: pendingExpense.description,
        categoryName: pendingExpense.suggested_new_category_name, // Nome da categoria guardado aqui
        flow: pendingExpense.suggested_category_flow,
        isInstallment: true, // Força true, pois o usuário está definindo parcelas
        installmentCount: installmentCount,
        cardName: null, // Não temos o cardName salvo no pending
    };
    const userContext = pendingExpense.description.match(/\(([^)]+)\)/)?.[1] || '';
    const categoryId = pendingExpense.suggested_category_id;
    const creditCardId = pendingExpense.credit_card_id;

    return this.createExpenseOrRevenueAndStartEditFlow(pendingExpense, analysisResult, userContext, categoryId, creditCardId);
  }

  async handleNumericReply(groupId, selectedNumber, participantPhone, profileId) {
    const pendingOnboarding = await OnboardingState.findOne({where: { group_id: groupId, initiator_phone: participantPhone, status: 'awaiting_profile_choice'}});
    if (pendingOnboarding) {
        return this.handleOnboardingResponse({phone: groupId, participantPhone, text: { message: selectedNumber.toString() }}, pendingOnboarding);
    }

    const isHandlingCreditCard = await this.handleNumericReplyForCreditCard(groupId, selectedNumber, participantPhone, profileId);
    if (isHandlingCreditCard) return true;

    const isHandlingInstallmentCount = await this.handleNumericReplyForInstallmentCount(groupId, selectedNumber, participantPhone, profileId);
    if (isHandlingInstallmentCount) return true;

    // === MUDANÇAS AQUI ===
    const pendingExpense = await PendingExpense.findOne({
      where: { whatsapp_group_id: groupId, participant_phone: participantPhone, profile_id: profileId, action_expected: 'awaiting_category_reply' },
      include: [{ model: Expense, as: 'expense' }, { model: Revenue, as: 'revenue' }]
    });

    if (!pendingExpense) { 
        logger.warn(`[Webhook] Resposta numérica de ${participantPhone} ignorada porque não há fluxo de resposta de categoria pendente.`);
        return false; // <<< CORREÇÃO: Retorna false para indicar que não foi tratado.
    }
    
    const originalFlow = pendingExpense.expense ? 'expense' : (pendingExpense.revenue ? 'revenue' : null);

    const allCategories = await Category.findAll({ 
        where: { 
            profile_id: profileId,
            ...(originalFlow && { category_flow: originalFlow })
        }, 
        order: [['name', 'ASC']] 
    });
    const selectedCategory = allCategories[selectedNumber - 1];

    if (!selectedCategory) { 
        const totalCategories = allCategories.length; 
        await whatsappService.sendWhatsappMessage(groupId, `⚠️ *Opção Inválida!* \n\nO número *${selectedNumber}* não está na lista. Responda com um número entre 1 e ${totalCategories}.`); 
        return true; 
    }

    let updatedEntry;
    if (pendingExpense.expense) {
        if (selectedCategory.category_flow !== 'expense') {
            await whatsappService.sendWhatsappMessage(groupId, `⚠️ A categoria "${selectedCategory.name}" é para *Receitas*, mas a despesa original é um *Custo*. Por favor, selecione uma categoria de despesa.`);
            return true;
        }
        await pendingExpense.expense.update({ category_id: selectedCategory.id });
        updatedEntry = pendingExpense.expense;
    } else if (pendingExpense.revenue) {
        if (selectedCategory.category_flow !== 'revenue') {
            await whatsappService.sendWhatsappMessage(groupId, `⚠️ A categoria "${selectedCategory.name}" é para *Despesas*, mas a receita original é uma *Receita*. Por favor, selecione uma categoria de receita.`);
            return true;
        }
        await pendingExpense.revenue.update({ category_id: selectedCategory.id });
        updatedEntry = pendingExpense.revenue;
    } else {
        // === MUDANÇAS AQUI ===
        // Reconstruindo o analysisResult a partir dos dados no pendingExpense
        const analysisResult = {
            value: pendingExpense.value,
            baseDescription: pendingExpense.description,
            categoryName: selectedCategory.name,
            flow: selectedCategory.category_flow,
            isInstallment: pendingExpense.installment_count ? true : false,
            installmentCount: pendingExpense.installment_count,
            cardName: null, // Não temos o cardName salvo no pending
        };
        const userContext = pendingExpense.description.match(/\(([^)]+)\)/)?.[1] || '';
        await this.createExpenseOrRevenueAndStartEditFlow(pendingExpense, analysisResult, userContext, selectedCategory.id, pendingExpense.credit_card_id);
        return true;
    }
    
    await pendingExpense.destroy();

    const formattedTotal = await (updatedEntry instanceof Expense ? Expense.sum('value', { where: { profile_id: profileId, original_expense_id: { [Op.eq]: null } } }) : Revenue.sum('value', { where: { profile_id: profileId } }));
    const formattedTotalString = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(formattedTotal || 0);
    const flowText = updatedEntry instanceof Expense ? 'Despesa' : 'Receita';

    const successMessage = `✅ *${flowText} Atualizada!* \n${flowText} #${updatedEntry.id}\nNova categoria: *${selectedCategory.name}*\n*Total de ${flowText === 'Despesa' ? 'Despesas' : 'Receitas'}:* ${formattedTotalString}`;
    await whatsappService.sendWhatsappMessage(groupId, successMessage);
    logger.info(`[Webhook] ${flowText} #${updatedEntry.id} atualizada para categoria ${selectedCategory.name} por ${participantPhone}.`);
    return true;
  }

  async handleEditButtonFlow(payload) {
      const buttonId = payload.buttonsResponseMessage.buttonId;
      const groupId = payload.phone;
      const clickerPhone = payload.participantPhone;
      const profileId = payload.profileId;
      const pendingExpenseId = buttonId.split('_')[2];
      
      const pendingExpense = await PendingExpense.findByPk(pendingExpenseId, { 
          where: { profile_id: profileId },
          include: [{ model: Expense, as: 'expense' }, { model: Revenue, as: 'revenue' }]
      });

      if (!pendingExpense) { await whatsappService.sendWhatsappMessage(groupId, `⏳ *Tempo Esgotado* ⏳\n\nO prazo para editar esta despesa já expirou ou ela não existe.`); return; }
      if (pendingExpense.participant_phone !== clickerPhone) { await whatsappService.sendWhatsappMessage(groupId, `🤚 *Atenção, ${clickerPhone}!* \n\nApenas a pessoa que registrou o item (${pendingExpense.participant_phone}) pode editá-lo.`); return; }
      
      const originalFlow = pendingExpense.expense ? 'expense' : (pendingExpense.revenue ? 'revenue' : null);

      const allCategories = await Category.findAll({ 
          where: { 
              profile_id: profileId,
              ...(originalFlow && { category_flow: originalFlow })
          }, 
          order: [['name', 'ASC']] 
      });
      const categoryListText = allCategories.map((cat, index) => `${index + 1} - ${cat.name} (${cat.category_flow === 'expense' ? 'Despesa' : 'Receita'})`).join('\n');
      
      const valueToFormat = pendingExpense.expense ? pendingExpense.expense.value : pendingExpense.revenue ? pendingExpense.revenue.value : pendingExpense.value;
      const descriptionToUse = pendingExpense.expense ? pendingExpense.expense.description : pendingExpense.revenue ? pendingExpense.revenue.description : pendingExpense.description;
      const flowText = pendingExpense.expense ? 'despesa' : 'receita';

      const formattedValue = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(valueToFormat);
      const message = `📋 *Escolha a Categoria Correta*\n\nVocê está definindo a categoria para a ${flowText} de *${formattedValue}* (${descriptionToUse}).\n\nResponda com o *número* da nova categoria: 👇\n\n${categoryListText}`;
      
      // === MUDANÇAS AQUI ===
      pendingExpense.action_expected = 'awaiting_category_reply'; // NOVO CAMPO
      pendingExpense.expires_at = new Date(Date.now() + EXPENSE_EDIT_WAIT_TIME_MINUTES * 60 * 1000); 
      await pendingExpense.save();
      await whatsappService.sendWhatsappMessage(groupId, message);
      logger.info(`[Webhook] Solicitação de escolha de categoria para pendência #${pendingExpense.id} por ${clickerPhone}.`);
  }

  async sendSpendingReport(groupId, recipientPhone, profileId) {
      try {
          const now = new Date();
          const filters = { period: 'monthly' };
          const kpis = await dashboardService.getKPIs(filters, profileId);
          const chartData = await dashboardService.getChartData(filters, profileId);
          
          if (!kpis || !chartData) { await whatsappService.sendWhatsappMessage(groupId, `❌ Não foi possível gerar o relatório.`); return; }
          
          const formattedTotalExpenses = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(kpis.totalExpenses);
          const formattedTotalRevenues = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(kpis.totalRevenues);
          const formattedBalance = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(kpis.balance);

          let expenseCategorySummary = 'Sem gastos por categoria este mês.';
          if (chartData.pieChart && chartData.pieChart.length > 0) {
              expenseCategorySummary = chartData.pieChart.sort((a, b) => b.value - a.value).map(cat => `- ${cat.name}: ${new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cat.value)}`).join('\n');
          }

          let revenueCategorySummary = 'Sem receitas por categoria este mês.';
          // TODO: Adicionar summary para receitas por categoria (necessita de endpoint no dashboardService)
          
          const currentMonth = new Intl.DateTimeFormat('pt-BR', { month: 'long' }).format(now);
          const currentYear = new Date().getFullYear();
          const formattedReportHeaderMonth = `${currentMonth.charAt(0).toUpperCase() + currentMonth.slice(1)}/${currentYear}`;
          
          const reportMessage = `📊 *Relatório Mensal Financeiro* 📊\n(${formattedReportHeaderMonth}) \n\n*Resumo:*\n💸 Total Despesas: ${formattedTotalExpenses}\n💰 Total Receitas: ${formattedTotalRevenues}\n⚖️ Saldo: ${formattedBalance}\n\n*Gastos por Categoria (Despesas):*\n${expenseCategorySummary}\n\n_Este relatório é referente aos dados registrados até o momento._`;
          
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

// Worker para limpar PendingExpenses expirados
const runPendingExpenseWorker = async () => {
    const now = new Date();
    try {
        // Limpa PendingExpenses de validação expirados
        await PendingExpense.destroy({ 
            where: { 
                action_expected: 'awaiting_validation', 
                expires_at: { [Op.lte]: now } 
            } 
        });
        
        // Lida com PendingExpenses de categoria expirados (seja para escolher ou criar)
        const expiredCategoryActions = await PendingExpense.findAll({ 
            where: { 
                action_expected: { 
                    [Op.in]: [
                        'awaiting_category_reply', 
                        'awaiting_new_category_decision', 
                        'awaiting_new_category_type', 
                        'awaiting_category_flow_decision', 
                        'awaiting_new_category_goal'
                    ] 
                }, 
                expires_at: { [Op.lte]: now } 
            }, 
            include: [
                { model: Category, as: 'suggestedCategory' }, 
                { model: Expense, as: 'expense' },
                { model: Revenue, as: 'revenue' }
            ] 
        });

        for (const pending of expiredCategoryActions) {
            const entryValue = pending.value; // Usa o 'value' guardado no PendingExpense
            const entryType = pending.suggested_category_flow || 'despesa'; // Usa o fluxo guardado
            const originalCategoryName = pending.suggested_new_category_name || 'N/A'; // Usa o nome sugerido guardado

            const formattedValue = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(entryValue);
            const timeoutMessage = `⏰ *Edição Expirada*\n\nO tempo para ${pending.action_expected === 'awaiting_category_reply' ? 'selecionar uma nova categoria' : 'decidir sobre a categoria'} para o lançamento de *${formattedValue}* expirou.`;
            
            // Se foi um PendingExpense que estava criando/editando uma despesa/receita, tenta usar a categoria padrão
            if (pending.expense_id || pending.revenue_id) {
                const existingEntry = pending.expense || pending.revenue;
                if (existingEntry) {
                    // Tenta encontrar a categoria original ou a padrão
                    let defaultCategory = await Category.findOne({
                        where: {
                            profile_id: pending.profile_id,
                            category_flow: pending.suggested_category_flow,
                            name: pending.suggested_category_flow === 'expense' ? 'Outros' : 'Receita Padrão'
                        }
                    });

                    if (defaultCategory) {
                        await existingEntry.update({ category_id: defaultCategory.id });
                        await whatsappService.sendWhatsappMessage(pending.whatsapp_group_id, `${timeoutMessage} O item foi categorizado como: *${defaultCategory.name}*.`);
                    } else {
                        await whatsappService.sendWhatsappMessage(pending.whatsapp_group_id, `${timeoutMessage} Não foi possível categorizar automaticamente. Por favor, adicione a categoria manualmente.`);
                    }
                }
            } else {
                // Se foi um PendingExpense para criar categoria avulsa do menu, apenas informa
                await whatsappService.sendWhatsappMessage(pending.whatsapp_group_id, timeoutMessage);
            }
            
            await pending.destroy(); // Destrói o PendingExpense expirado
        }
        
        // Limpa outros PendingExpenses "soltos" que não levaram a nada ou que foram criados para fluxos de cartão
        await PendingExpense.destroy({ 
            where: { 
                action_expected: { 
                    [Op.in]: [
                        'awaiting_context', 
                        'awaiting_ai_analysis_complete', 
                        'awaiting_credit_card_choice', 
                        'awaiting_installment_count', 
                        'awaiting_new_card_name', 
                        'awaiting_new_card_closing_day', 
                        'awaiting_new_card_due_day', 
                        'awaiting_card_creation_confirmation'
                    ] 
                }, 
                expires_at: { [Op.lte]: now } 
            } 
        });

    } catch (error) {
        console.error('[WORKER] ❌ Erro ao processar despesas pendentes (action_expected):', error);
    }
};

// Exporta o worker para ser iniciado em app.js
WebhookService.runPendingExpenseWorker = runPendingExpenseWorker;


module.exports = new WebhookService();