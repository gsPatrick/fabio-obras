// src/utils/whatsappService.js
const axios = require('axios');
const logger = require('./logger');
const fs = require('fs');
const path = require('path');
const mime = require('mime-types');

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
 */
async function sendWhatsappMessage(phone, message) {
  // ... (função sem alterações)
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
 */
async function sendOptionList(phone, messageText, optionListConfig) {
    // ... (função sem alterações)
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
 * <<< CORREÇÃO: A função agora usa o endpoint /chats para obter a lista completa de grupos. >>>
 * Obtém a lista de todos os grupos da instância.
 */
async function listGroups() {
  if (!checkCredentials()) return null;
  
  // Endpoint correto, conforme recomendação
  const endpoint = `${BASE_URL}/chats`;

  try {
    logger.info('[WhatsAppService] Buscando lista de chats para filtrar os grupos...');
    const response = await axios.get(endpoint, { headers });

    // Filtra apenas os chats que são grupos
    const allChats = response.data.chats || [];
    const groups = allChats.filter(chat => chat.isGroup);

    logger.info(`[WhatsAppService] ${groups.length} grupos encontrados.`);
    return groups;
  } catch (error) {
    const status = error.response ? error.response.status : 'N/A';
    const errorData = error.response ? error.response.data : error.message;
    logger.error(`[WhatsAppService] Erro ao listar chats/grupos (Status: ${status}):`, errorData);
    return null;
  }
}

/**
 * Baixa uma mídia a partir de uma URL da Z-API.
 */
async function downloadZapiMedia(mediaUrl) {
  // ... (função sem alterações)
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
 */
async function sendButtonList(phone, messageText, buttons) {
  // ... (função sem alterações)
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
 * Envia um documento (arquivo) via WhatsApp.
 */
async function sendDocument(phone, filePath, caption = '') {
  // ... (função sem alterações)
  if (!checkCredentials() || !phone || !filePath || !fs.existsSync(filePath)) {
    logger.error('[WhatsAppService] Parâmetros inválidos para sendDocument ou arquivo não encontrado.');
    return null;
  }

  const fileExtension = path.extname(filePath).substring(1);
  const filename = path.basename(filePath);
  const mimeType = mime.lookup(filePath) || 'application/octet-stream';
  
  const fileBuffer = fs.readFileSync(filePath);
  const base64File = fileBuffer.toString('base64');
  
  const payload = {
    phone,
    document: `data:${mimeType};base64,${base64File}`,
    fileName: filename,
    caption: caption,
  };

  try {
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
    // ... (função sem alterações)
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
};