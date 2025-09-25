const axios = require('axios');
const logger = require('./logger');

// Carrega as credenciais a partir das variáveis de ambiente
const { ZAPI_INSTANCE_ID, ZAPI_TOKEN, ZAPI_CLIENT_TOKEN } = process.env;
const BASE_URL = `https://api.z-api.io/instances/${ZAPI_INSTANCE_ID}/token/${ZAPI_TOKEN}`;

// Define os headers que serão usados em todas as requisições para a Z-API
const headers = {
  'Content-Type': 'application/json',
  'client-token': ZAPI_CLIENT_TOKEN,
};

/**
 * Função interna para verificar se as credenciais da Z-API estão presentes.
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
 * Envia uma mensagem de texto simples para um número ou grupo.
 * @param {string} phone - O número do destinatário ou ID do grupo.
 * @param {string} message - A mensagem a ser enviada.
 * @returns {Promise<object|null>} A resposta da API da Z-API ou null em caso de erro.
 */
async function sendWhatsappMessage(phone, message) {
  if (!checkCredentials() || !phone || !message) {
    logger.error('[WhatsAppService] Telefone e mensagem são obrigatórios para envio de texto.');
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
 * Envia uma lista de opções (menu) para um número ou grupo.
 * @param {string} phone - O ID do grupo ou número de telefone.
 * @param {string} messageText - A mensagem principal exibida acima da lista.
 * @param {object} optionListConfig - Configurações da lista.
 * @param {string} optionListConfig.title - Título do menu.
 * @param {string} optionListConfig.buttonLabel - Texto do botão para abrir o menu.
 * @param {Array<object>} optionListConfig.options - Array de opções no formato [{ id, title, description }].
 * @returns {Promise<object|null>} A resposta da API da Z-API ou null em caso de erro.
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
 * Obtém a lista de todos os grupos da instância, usando o endpoint correto e paginação.
 * @returns {Promise<Array|null>} Um array com os objetos dos grupos ou null em caso de erro.
 */
async function listGroups() {
  if (!checkCredentials()) return null;

  const endpoint = `${BASE_URL}/groups`;
  const params = {
    page: 1,
    pageSize: 100, // Busca até 100 grupos, ajuste se necessário.
  };

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
 * Baixa uma mídia (imagem, documento, áudio) a partir de uma URL da Z-API.
 * @param {string} mediaUrl A URL da mídia fornecida pelo webhook.
 * @returns {Promise<Buffer|null>} O buffer do arquivo ou null em caso de erro.
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
      responseType: 'arraybuffer', // Crucial para receber os dados binários do arquivo
    });
    
    logger.info(`[WhatsAppService] Mídia baixada com sucesso. Tamanho: ${response.data.length} bytes.`);
    return Buffer.from(response.data); // Retorna a mídia como um Buffer

  } catch (error) {
    const status = error.response ? error.response.status : 'N/A';
    const errorData = error.response ? error.response.data : error.message;
    logger.error(`[WhatsAppService] Erro ao baixar mídia (Status: ${status})`, { errorData });
    return null;
  }
}

// Exporta todas as funções públicas para que possam ser usadas em outras partes do sistema.
module.exports = {
  sendWhatsappMessage,
  sendOptionList,
  listGroups,
  downloadZapiMedia,
};