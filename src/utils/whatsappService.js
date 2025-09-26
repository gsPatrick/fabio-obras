const axios = require('axios');
const logger = require('./logger');

const { ZAPI_INSTANCE_ID, ZAPI_TOKEN, ZAPI_CLIENT_TOKEN } = process.env;
const BASE_URL = `https://api.z-api.io/instances/${ZAPI_INSTANCE_ID}/token/${ZAPI_TOKEN}`;

const headers = {
  'Content-Type': 'application/json',
  'client-token': ZAPI_CLIENT_TOKEN,
};

function checkCredentials() {
  if (!ZAPI_INSTANCE_ID || !ZAPI_TOKEN || !ZAPI_CLIENT_TOKEN) {
    logger.error('[WhatsAppService] Variáveis de ambiente da Z-API não configuradas.');
    return false;
  }
  return true;
}

/**
 * Envia uma mensagem de texto simples.
 * @param {string} phone - Número do destinatário ou ID do grupo.
 * @param {string} message - A mensagem a ser enviada.
 */
async function sendWhatsappMessage(phone, message) {
  if (!checkCredentials() || !phone || !message) {
    logger.error('[WhatsAppService] Telefone e mensagem são obrigatórios.');
    return null;
  }
  const endpoint = `${BASE_URL}/send-text`;
  const payload = { phone, message };
  try {
    logger.info(`[WhatsAppService] Enviando mensagem de TEXTO para ${phone}`);
    const response = await axios.post(endpoint, payload, { headers });
    logger.info(`[WhatsAppService] Mensagem enviada com sucesso para ${phone}.`, response.data);
    return response.data;
  } catch (error) {
    const errorData = error.response ? error.response.data : error.message;
    logger.error(`[WhatsAppService] Erro ao enviar mensagem para ${phone}:`, errorData);
    return null;
  }
}

/**
 * Envia uma lista de opções (menu).
 * @param {string} phone - O ID do grupo ou número de telefone.
 * @param {string} messageText - A mensagem principal.
 * @param {object} optionListConfig - Configurações da lista.
 */
async function sendOptionList(phone, messageText, optionListConfig) {
    if (!checkCredentials() || !phone || !messageText || !optionListConfig) {
        logger.error('[WhatsAppService] Parâmetros inválidos para sendOptionList.');
        return null;
    }
    const endpoint = `${BASE_URL}/send-option-list`;
    const payload = {
        phone,
        message: messageText,
        optionList: {
            title: optionListConfig.title,
            buttonLabel: optionListConfig.buttonLabel,
            options: optionListConfig.options,
        },
    };
    try {
        logger.info(`[WhatsAppService] Enviando LISTA DE OPÇÕES para ${phone}.`);
        const response = await axios.post(endpoint, payload, { headers });
        logger.info(`[WhatsAppService] Lista de opções enviada com sucesso para ${phone}.`, response.data);
        return response.data;
    } catch (error) {
        const errorData = error.response ? error.response.data : error.message;
        logger.error(`[WhatsAppService] Erro ao enviar lista de opções para ${phone}:`, errorData);
        return null;
    }
}

/**
 * Obtém a lista de todos os grupos da instância.
 */
async function listGroups() {
  if (!checkCredentials()) return null;
  const endpoint = `${BASE_URL}/groups`;
  const params = { page: 1, pageSize: 100 };
  try {
    logger.info('[WhatsAppService] Buscando lista de grupos...');
    const response = await axios.get(endpoint, { headers, params });
    logger.info(`[WhatsAppService] ${response.data.length} grupos encontrados.`);
    return response.data;
  } catch (error) {
    const status = error.response ? error.response.status : 'N/A';
    const errorData = error.response ? error.response.data : error.message;
    logger.error(`[WhatsAppService] Erro ao listar grupos (Status: ${status}):`, errorData);
    return null;
  }
}

/**
 * Baixa uma mídia a partir de uma URL da Z-API.
 * @param {string} mediaUrl A URL da mídia.
 * @returns {Promise<Buffer|null>} O buffer do arquivo.
 */
async function downloadZapiMedia(mediaUrl) {
  if (!checkCredentials() || !mediaUrl) {
    logger.error('[WhatsAppService] URL da mídia é necessária para download.');
    return null;
  }
  try {
    logger.info(`[WhatsAppService] Baixando mídia de: ${mediaUrl}`);
    const response = await axios({
      method: 'get',
      url: mediaUrl,
      headers: { 'client-token': ZAPI_CLIENT_TOKEN },
      responseType: 'arraybuffer',
    });
    logger.info(`[WhatsAppService] Mídia baixada com sucesso. Tamanho: ${response.data.length} bytes.`);
    return Buffer.from(response.data);
  } catch (error) {
    const status = error.response ? error.response.status : 'N/A';
    const errorData = error.response ? error.response.data : error.message;
    logger.error(`[WhatsAppService] Erro ao baixar mídia (Status: ${status})`, { errorData });
    return null;
  }
}

/**
 * Envia uma mensagem com botões simples.
 * @param {string} phone - O ID do grupo.
 * @param {string} messageText - A mensagem principal.
 * @param {Array<{id: string, label: string}>} buttons - Um array de objetos de botão.
 */
async function sendButtonList(phone, messageText, buttons) {
  if (!checkCredentials() || !phone || !messageText || !buttons) {
    logger.error('[WhatsAppService] Parâmetros inválidos para sendButtonList.');
    return null;
  }
  const endpoint = `${BASE_URL}/send-button-list`;
  const payload = {
    phone,
    message: messageText,
    buttonList: {
      buttons: buttons,
    },
  };
  try {
    logger.info(`[WhatsAppService] Enviando MENSAGEM COM BOTÕES para ${phone}.`);
    const response = await axios.post(endpoint, payload, { headers });
    logger.info(`[WhatsAppService] Mensagem com botões enviada com sucesso para ${phone}.`, response.data);
    return response.data;
  } catch (error) {
    const errorData = error.response ? error.response.data : error.message;
    logger.error(`[WhatsAppService] Erro ao enviar mensagem com botões para ${phone}:`, errorData);
    return null;
  }
}

module.exports = {
  sendWhatsappMessage,
  sendOptionList,
  listGroups,
  downloadZapiMedia,
  sendButtonList
};



async function runPendingExpenseWorker() {
  console.log('[WORKER] ⚙️ Verificando despesas pendentes expiradas...');
  const now = new Date();

  try {
    // 1. CONFIRMAÇÃO AUTOMÁTICA (após 3 minutos de validação)
    const expiredValidations = await PendingExpense.findAll({
      where: {
        status: 'awaiting_validation',
        expires_at: { [Op.lte]: now }
      },
      include: [{ model: Category, as: 'suggestedCategory' }]
    });

    for (const pending of expiredValidations) {
      console.log(`[WORKER] ✅ Confirmando automaticamente a despesa ID: ${pending.id}`);
      await Expense.create({
        value: pending.value,
        description: pending.description,
        expense_date: pending.createdAt,
        whatsapp_message_id: pending.whatsapp_message_id,
        category_id: pending.suggested_category_id,
      });
      const successMessage = `✅ *Custo Confirmado Automaticamente*\n\n` +
                             `A despesa de *${new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(pending.value)}* ` +
                             `foi registrada na categoria *${pending.suggestedCategory.name}*.`;
      await whatsappService.sendWhatsappMessage(pending.whatsapp_group_id, successMessage);
      await pending.destroy();
    }

    // 2. TIMEOUT DE EDIÇÃO (após 3 minutos esperando resposta numérica)
    const expiredReplies = await PendingExpense.findAll({
      where: {
        status: 'awaiting_category_reply',
        expires_at: { [Op.lte]: now }
      },
      include: [{ model: Category, as: 'suggestedCategory' }]
    });

    for (const pending of expiredReplies) {
      console.log(`[WORKER] ⏰ Finalizando edição não respondida da despesa ID: ${pending.id}`);
      await Expense.create({
        value: pending.value,
        description: pending.description,
        expense_date: pending.createdAt,
        whatsapp_message_id: pending.whatsapp_message_id,
        category_id: pending.suggested_category_id,
      });
      const timeoutMessage = `⏰ *Edição Expirada*\n\n` +
                             `O tempo para selecionar uma nova categoria expirou. A despesa foi confirmada com a categoria original: *${pending.suggestedCategory.name}*.`;
      await whatsappService.sendWhatsappMessage(pending.whatsapp_group_id, timeoutMessage);
      await pending.destroy();
    }

    // 3. LIMPEZA DE CONTEXTOS (após 2 minutos esperando descrição)
    await PendingExpense.destroy({
      where: {
        status: 'awaiting_context',
        expires_at: { [Op.lte]: now }
      }
    });

  } catch (error) {
    console.error('[WORKER] ❌ Erro ao processar despesas pendentes:', error);
  }
}

