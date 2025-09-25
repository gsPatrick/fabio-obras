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

// ========================================================================
// <<< INÍCIO DA CORREÇÃO >>>
// ========================================================================

/**
 * Obtém a lista de todos os grupos da instância, usando o endpoint correto e paginação.
 * @returns {Promise<Array|null>}
 */
async function listGroups() {
  if (!checkCredentials()) return null;

  // <<< MUDANÇA 1: Usando o endpoint /groups >>>
  const endpoint = `${BASE_URL}/groups`;
  
  // <<< MUDANÇA 2: Adicionando os parâmetros de paginação obrigatórios >>>
  // Vamos buscar um número grande para garantir que todos os grupos venham.
  const params = {
    page: 1,
    pageSize: 100,
  };

  try {
    logger.info('[WhatsAppService] Buscando lista de grupos...');
    
    // <<< MUDANÇA 3: A chamada GET agora inclui os parâmetros >>>
    const response = await axios.get(endpoint, { headers, params });
    
    // <<< MUDANÇA 4: A resposta é um array direto, não um objeto com a chave "chats" >>>
    logger.info(`[WhatsAppService] ${response.data.length} grupos encontrados.`);
    return response.data;

  } catch (error) {
    // Tratamento de erro mais detalhado
    const status = error.response ? error.response.status : 'N/A';
    const errorData = error.response ? error.response.data : error.message;
    logger.error(`[WhatsAppService] Erro ao listar grupos (Status: ${status}):`, errorData);
    return null;
  }
}

// ========================================================================
// <<< FIM DA CORREÇÃO >>>
// ========================================================================

module.exports = {
  sendWhatsappMessage,
  sendOptionList,
  listGroups, // <<< MUDANÇA 5: Exportando a função correta
};