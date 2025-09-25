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

module.exports = {
  sendWhatsappMessage,
  sendOptionList,
  listGroups,
  downloadZapiMedia,
};