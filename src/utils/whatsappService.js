// src/utils/whatsappService.js
const axios = require('axios');
const logger = require('./logger');
const fs = require('fs');
const path = require('path');
const mime = require('mime-types'); // MUDANÇA: Importar mime-types

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

/**
 * MUDANÇA: NOVA FUNÇÃO PARA ENVIAR DOCUMENTOS (corrigida)
 * Envia um documento (arquivo) via WhatsApp.
 * @param {string} phone - O número do destinatário ou ID do grupo.
 * @param {string} filePath - O caminho completo para o arquivo local a ser enviado.
 * @param {string} caption - A legenda (texto) que acompanha o documento.
 * @returns {Promise<object|null>} O resultado da API ou null em caso de erro.
 */
async function sendDocument(phone, filePath, caption = '') {
  if (!checkCredentials() || !phone || !filePath || !fs.existsSync(filePath)) {
    logger.error('[WhatsAppService] Parâmetros inválidos para sendDocument ou arquivo não encontrado.');
    return null;
  }

  // MUDANÇA: Extrair extensão e mimetype do arquivo para o endpoint e payload
  const fileExtension = path.extname(filePath).substring(1); // Ex: 'xlsx'
  const filename = path.basename(filePath);
  const mimeType = mime.lookup(filePath) || 'application/octet-stream'; // Ex: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  
  const fileBuffer = fs.readFileSync(filePath);
  const base64File = fileBuffer.toString('base64');
  
  // MUDANÇA: Ajustar payload conforme a documentação da Z-API
  const payload = {
    phone,
    document: `data:${mimeType};base64,${base64File}`, // Data URI completo no atributo 'document'
    fileName: filename,
    caption: caption, // Usar 'caption' para a legenda
  };

  try {
    // MUDANÇA: Construir o endpoint com a extensão do arquivo
    const fullEndpoint = `${BASE_URL}/send-document/${fileExtension}`;
    logger.info(`[WhatsAppService] Enviando documento '${filename}' para ${phone} via ${fullEndpoint}...`);
    const response = await axios.post(fullEndpoint, payload, { headers });
    logger.info(`[WhatsAppService] Documento enviado com sucesso para ${phone}.`, response.data);
    return response.data;
  } catch (error) {
    const errorData = error.response ? error.response.data : error.message;
    logger.error(`[WhatsAppService] Erro ao enviar documento '${filename}' para ${phone}:`, errorData);
    return null;
  }
}

async function getGroupMetadata(groupId) {
    if (!checkCredentials() || !groupId) {
        logger.error('[WhatsAppService] ID do grupo é obrigatório para obter metadados.');
        return null;
    }
    const endpoint = `${BASE_URL}/group-metadata/${groupId}`;
    try {
        logger.debug(`[WhatsAppService] Buscando metadados do grupo: ${groupId}`);
        const response = await axios.get(endpoint, { headers });
        return response.data;
    } catch (error) {
        const errorData = error.response ? error.response.data : error.message;
        logger.error(`[WhatsAppService] Erro ao obter metadados para ${groupId}:`, errorData);
        return null;
    }
}


module.exports = {
  sendWhatsappMessage,
  sendOptionList,
  listGroups,
  downloadZapiMedia,
  sendButtonList,
  sendDocument,
  getGroupMetadata
  // MUDANÇA: Exportar a função sendDocument corrigida
};