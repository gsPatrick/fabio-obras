const axios = require('axios');
const logger = require('./logger');

const { ZAPI_INSTANCE_ID, ZAPI_TOKEN, ZAPI_CLIENT_TOKEN } = process.env;
const BASE_URL = `https://api.z-api.io/instances/${ZAPI_INSTANCE_ID}/token/${ZAPI_TOKEN}`;

const headers = {
  'Content-Type': 'application/json',
  'client-token': ZAPI_CLIENT_TOKEN,
};

/**
 * Verifica se as credenciais da Z-API estão configuradas.
 * @returns {boolean}
 */
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
 * @returns {Promise<object|null>}
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
 * @param {string} messageText - A mensagem principal exibida acima da lista.
 * @param {object} optionListConfig - Configurações da lista.
 * @param {string} optionListConfig.title - Título do menu.
 * @param {string} optionListConfig.buttonLabel - Texto do botão para abrir o menu.
 * @param {Array<object>} optionListConfig.options - Array de opções.
 * @returns {Promise<object|null>}
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
            options: optionListConfig.options, // [{ id, title, description }]
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
 * Obtém a lista de todos os chats (incluindo grupos) da instância.
 * @returns {Promise<Array|null>}
 */
async function listChats() {
  if (!checkCredentials()) return null;

  const endpoint = `${BASE_URL}/chats`;
  try {
    logger.info('[WhatsAppService] Buscando lista de chats...');
    const response = await axios.get(endpoint, { headers });
    logger.info(`[WhatsAppService] ${response.data.chats.length} chats encontrados.`);
    return response.data.chats;
  } catch (error) {
    const errorData = error.response ? error.response.data : error.message;
    logger.error('[WhatsAppService] Erro ao listar chats:', errorData);
    return null;
  }
}

module.exports = {
  sendWhatsappMessage,
  sendOptionList,
  listChats,
};