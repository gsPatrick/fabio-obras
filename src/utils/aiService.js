// src/utils/aiService.js
'use strict';

require('dotenv').config();
const OpenAI = require('openai');
const logger = require('./logger');
const { Category, CreditCard } = require('../models');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { Poppler } = require('node-poppler');

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  timeout: 60 * 1000, // 60 segundos para extração de planilha
});

class AIService {

  /**
   * Transcreve um buffer de áudio para texto usando o Whisper.
   */
  async transcribeAudio(audioBuffer) {
    if (!audioBuffer) return null;
    logger.info('[AIService] Iniciando transcrição de áudio com Whisper...');
    try {
      const tempFilePath = path.join(os.tmpdir(), `audio-${Date.now()}.ogg`);
      fs.writeFileSync(tempFilePath, audioBuffer);
      const transcription = await openai.audio.transcriptions.create({
        file: fs.createReadStream(tempFilePath),
        model: 'whisper-1',
      });
      fs.unlinkSync(tempFilePath);
      logger.info(`[AIService] Áudio transcrito: "${transcription.text}"`);
      return transcription.text;
    } catch (error) {
      logger.error('[AIService] Erro ao transcrever áudio:', error);
      return null;
    }
  }

  /**
   * Converte um buffer de PDF na primeira página como um buffer de imagem JPEG.
   */
  async _convertPdfToImage(pdfBuffer) {
    logger.info('[AIService] PDF detectado. Iniciando conversão com node-poppler...');
    const poppler = new Poppler(); 
    const tempPdfPath = path.join(os.tmpdir(), `doc-${Date.now()}.pdf`);
    const tempOutputPath = path.join(os.tmpdir(), `img-${Date.now()}`);

    try {
      fs.writeFileSync(tempPdfPath, pdfBuffer);

      const options = {
        firstPageToConvert: 1,
        lastPageToConvert: 1,
        jpegFile: true,
      };

      await poppler.pdfToCairo(tempPdfPath, tempOutputPath, options);
      
      const imagePath = `${tempOutputPath}-1.jpg`;

      const imageBuffer = fs.readFileSync(imagePath);
      logger.info('[AIService] PDF convertido para imagem com sucesso.');
      return imageBuffer;
      
    } catch (error) {
      logger.error('[AIService] Erro crítico durante a conversão do PDF com node-poppler.', error);
      return null;
    } finally {
      if (fs.existsSync(tempPdfPath)) fs.unlinkSync(tempPdfPath);
      const imagePath = `${tempOutputPath}-1.jpg`;
      if (fs.existsSync(imagePath)) fs.unlinkSync(imagePath);
    }
  }

  /**
   * Analisa um arquivo XLSX (em formato CSV String) para extrair despesas e categorizá-las.
   */
  async analyzeExcelStructureAndExtractData(csvString, categoryList) {
    logger.info('[AIService] Iniciando análise de estrutura de planilha universal...');
    
    const expenseCategoryNames = categoryList.filter(c => c.category_flow === 'expense').map(c => c.name.trim()).filter(c => c.length > 0);
    const expenseCategoryOptions = `"${expenseCategoryNames.join('", "')}"`;

    const prompt = `
      Você é um especialista em análise de planilhas financeiras de CUSTOS (despesas). Sua missão é extrair dados de despesas de forma universal de uma planilha CSV (separada por pipe '|') desestruturada.
      
      Regras CRÍTICAS Universais:
      1.  **Foco APENAS em Despesas:** Ignore qualquer coluna ou valor que represente 'ENTRADA', 'RECEITA', ou valores positivos que não sejam despesas (a menos que a descrição indique um custo). **O sistema é APENAS para despesas.**
      2.  **Identificação de Colunas:** A coluna de Valor de CUSTO é a que contém a maioria dos números monetários de SAÍDA. A coluna de Data é a que contém o formato de data mais consistente. A coluna de Descrição é a que possui o texto mais descritivo.
      3.  **Consolidação de Despesas:** Para cada linha com uma DATA e DESCRIÇÃO, se houver um valor em UMA ou MAIS colunas de CUSTO, gere uma DESPESA SEPARADA para CADA valor de custo.
      4.  **Descrição Final:** A descrição deve ser a DESCRIÇÃO ORIGINAL CONCATENADA com o NOME DO CABEÇALHO DA COLUNA DE CUSTO (Ex: 'COMPRA DE CIMENTO - FABIO').
      5.  **Data:** Converta para o formato 'YYYY-MM-DD'. Use o ano atual (ou o ano mais provável, como 2024/2025) se o ano não estiver especificado (Ex: '12-abr.' -> '2025-04-12').
      6.  **Categorização:** Mapeie para uma das categorias de DESPESA existentes: [${expenseCategoryOptions}]. Use "Outros" se não houver mapeamento claro.
      
      Estrutura do retorno JSON:
      {
          "expenses": [
              {
                  "value": number,
                  "date": "YYYY-MM-DD",
                  "description": "string (Consolidada e completa)",
                  "categoryName": "string (da lista fornecida)"
              }
          ],
          "reason": "string (motivo da falha se 'expenses' estiver vazio, ex: 'Nenhuma coluna de custo identificada')"
      }
      
      Planilha CSV (Separador '|'):
      --- PLANILHA INÍCIO ---
      ${csvString}
      --- PLANILHA FIM ---
    `;

    try {
      const response = await openai.chat.completions.create({
        model: 'gpt-3.5-turbo-0125', 
        messages: [{
          role: 'user',
          content: [{ type: 'text', text: prompt }],
        }],
        response_format: { type: "json_object" },
        temperature: 0.1, 
      });

      const resultString = response.choices[0].message.content;
      logger.info('[AIService] Análise de planilha concluída.');
      return resultString; 
      
    } catch (error) {
      logger.error('[AIService] Erro na análise de planilha:', error);
      
      if (error.status === 400 || error.status === 429) {
          return JSON.stringify({ expenses: [], reason: `Erro da API OpenAI. Código: ${error.status}` });
      }
      
      return JSON.stringify({ expenses: [], reason: `Erro crítico de comunicação/timeout com a IA. Tente novamente.` });
    }
  }

  /**
   * Analisa um comprovante (imagem ou PDF) e um texto de contexto.
   * Retorna informações detalhadas incluindo fluxo (despesa/receita), parcelamento e cartão.
   */
  async analyzeExpenseWithImage(mediaBuffer, userText, mimeType = 'image/jpeg', profileId, cardNames = []) { 
    logger.info(`[AIService] Iniciando análise detalhada de mídia (${mimeType}).`);
    
    let finalImageBuffer = mediaBuffer;

    if (mimeType.includes('pdf')) {
      const convertedImage = await this._convertPdfToImage(mediaBuffer);
      if (!convertedImage) {
        logger.error('[AIService] Falha na conversão de PDF, cancelando análise.');
        return null;
      }
      finalImageBuffer = convertedImage;
    }
    
    const categories = await Category.findAll({ where: { profile_id: profileId }, attributes: ['name', 'category_flow'] }); 
    const expenseCategoryList = `"${categories.filter(c => c.category_flow === 'expense').map(c => c.name).join('", "')}"`;
    const revenueCategoryList = `"${categories.filter(c => c.category_flow === 'revenue').map(c => c.name).join('", "')}"`;

    const creditCardNames = `"${cardNames.join('", "')}"`;
    const base64Image = finalImageBuffer.toString('base64');
    
    const prompt = `
      Você é um especialista em análise de documentos financeiros (comprovantes, notas) e texto.
      Extraia as informações da IMAGEM e do TEXTO fornecido e retorne APENAS um objeto JSON válido com as chaves:
      "value" (Número), "flow" (String: 'expense' ou 'revenue'), "baseDescription" (String), "categoryName" (String),
      "isInstallment" (Booleano), "installmentCount" (Número, se for parcelado), "cardName" (String, se for cartão de crédito),
      "closingDay" (Número do dia do mês, se o texto mencionar "fechamento do cartão" ou "melhor dia de compra" e um número),
      "dueDay" (Número do dia do mês, se o texto mencionar "vencimento do cartão" e um número).
      
      Regras CRÍTICAS:
      1.  **Valor:** Extraia o valor monetário principal. Se o contexto indicar "salário" ou "recebimento", o valor é positivo. Se for "pagamento", "compra", "gasto", é uma despesa.
      2.  **Flow:** Determine se é 'expense' (despesa) ou 'revenue' (receita) com base na imagem e no contexto. Priorize 'expense' para documentos de compra/gasto.
      3.  **CategoryName:** Sua prioridade é mapear para uma categoria existente. DESPESAS: [${expenseCategoryList}]. RECEITAS: [${revenueCategoryList}]. SE a descrição indicar um nome de categoria que não está na lista (ex: "gasolina", "mercado"), use esse nome como 'categoryName'. Caso contrário, se não houver mapeamento claro, use "Outros" para despesas ou "Receita Padrão" para receitas.
      4.  **isInstallment:** Se a despesa for parcelada (ex: "3x", "parcelado", "prestação"), defina como true.
      5.  **installmentCount:** Se for parcelado, extraia o número total de parcelas (ex: "3" de "3x").
      6.  **cardName:** Se o texto ou a imagem indicar um cartão de crédito, identifique-o. Você tem uma lista de cartões existentes: [${creditCardNames}]. Se o texto mencionar um nome similar (ex: "nubak", "nu bank"), normalize para o nome correto da lista (ex: "Nubank"). Se não houver correspondência clara, mas a compra for de crédito, use o nome mencionado.
      7.  **closingDay e dueDay:** Apenas se o texto pedir explicitamente para CRIAR ou CONFIGURAR um cartão (ex: "criar cartão X fechamento dia Y vencimento Z"), extraia esses números. Caso contrário, devem ser null.
      
      Contexto do usuário: "${userText || 'Nenhum'}"
    `;

    try {
      const response = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64Image}` } },
          ],
        }],
        response_format: { type: "json_object" },
      });

      const result = JSON.parse(response.choices[0].message.content);
      logger.info('[AIService] Análise detalhada concluída.', result);
      return this._validateAnalysisResult(result, categories, cardNames);
    } catch (error) {
      logger.error('[AIService] Erro na análise detalhada:', error);
      return null;
    }
  }

  /**
   * Analisa um texto puro (mensagem de WhatsApp) para extrair despesas ou receitas, parcelamento e cartão.
   * Retorna informações detalhadas, incluindo dias de fechamento/vencimento se aplicável à criação de cartão.
   */
  async analyzeTextForExpenseOrRevenue(userText, profileId, cardNames = []) {
    logger.info(`[AIService] Iniciando análise de texto puro: "${userText}"`);

    const categories = await Category.findAll({ where: { profile_id: profileId }, attributes: ['name', 'category_flow'] }); 
    const expenseCategoryList = `"${categories.filter(c => c.category_flow === 'expense').map(c => c.name).join('", "')}"`;
    const revenueCategoryList = `"${categories.filter(c => c.category_flow === 'revenue').map(c => c.name).join('", "')}"`;

    const creditCardNames = `"${cardNames.join('", "')}"`;

    const prompt = `
      Você é um especialista em análise de texto financeiro para um bot de WhatsApp. Sua tarefa é analisar a mensagem do usuário e extrair informações de despesa, receita ou criação de cartão.
      Retorne APENAS um objeto JSON válido com as chaves:
      "value" (Número, ou null), "flow" (String: 'expense' ou 'revenue', ou null), "baseDescription" (String),
      "categoryName" (String, ou null), "isInstallment" (Booleano), "installmentCount" (Número, se parcelado),
      "cardName" (String, se for cartão de crédito), "closingDay" (Número), "dueDay" (Número).
      
      Regras CRÍTICAS:
      1.  **Cenário 1: Lançamento de Despesa/Receita.**
          *   Se o texto contém um valor monetário e uma descrição de compra/pagamento/recebimento (ex: "1500 mercado", "recebi 3000 salario").
          *   "value": Extraia o valor numérico.
          *   "flow": Determine se é 'expense' ou 'revenue'. Se não for claro, assuma 'expense'.
          *   "categoryName": Mapeie para uma categoria de DESPESA [${expenseCategoryList}] ou RECEITA [${revenueCategoryList}]. Se a descrição contiver um nome óbvio que não está na lista (ex: "aluguel", "material"), use esse nome. Se não, use "Outros" para despesa ou "Receita Padrão" para receita.
          *   "isInstallment" & "installmentCount": Se mencionar parcelas (ex: "3x", "em 2 vezes"), popule os campos.
          *   "cardName": Se mencionar um cartão, identifique-o. A lista de cartões existentes é: [${creditCardNames}]. Se o texto mencionar um nome similar (ex: "nubak", "cartao nu"), normalize para o nome exato da lista (ex: "Nubank").
          *   "closingDay" e "dueDay" devem ser null neste cenário.

      2.  **Cenário 2: Criação de Cartão de Crédito.**
          *   Se o texto contém palavras-chave como "criar cartão", "novo cartão", "adicionar cartão".
          *   "value", "flow", "categoryName", "isInstallment", "installmentCount" devem ser null.
          *   "cardName": Extraia o nome do novo cartão (ex: "Visa Platinum").
          *   "closingDay": Extraia o número do dia de fechamento (ex: de "fechamento dia 10").
          *   "dueDay": Extraia o número do dia de vencimento (ex: de "vencimento dia 20").

      3.  **Ambiguidade:** Se o texto for ambíguo, priorize o Cenário 1 (Lançamento). Se não houver valor monetário claro, considere o Cenário 2. Se nenhum se encaixar, retorne todos os campos como null, exceto "baseDescription" com o texto original.

      Texto do usuário: "${userText}"
    `;

    try {
      const response = await openai.chat.completions.create({
        model: 'gpt-4o', 
        messages: [{
          role: 'user',
          content: [{ type: 'text', text: prompt }],
        }],
        response_format: { type: "json_object" },
        temperature: 0.1, 
      });

      const result = JSON.parse(response.choices[0].message.content);
      logger.info('[AIService] Análise de texto puro concluída.', result);
      return this._validateAnalysisResult(result, categories, cardNames);
    } catch (error) {
      logger.error('[AIService] Erro na análise de texto puro:', error);
      return null;
    }
  }

  _validateAnalysisResult(result, categories, cardNames = []) {
    if (result.value !== null) {
        if (!result.flow || !['expense', 'revenue'].includes(result.flow)) {
            result.flow = 'expense';
            logger.warn(`[AIService] IA sugeriu fluxo inválido/vazio para lançamento. Usando 'expense'.`);
        }
    } else if (!result.cardName || !result.closingDay || !result.dueDay) {
        // Se não for um lançamento de valor e nem uma criação de cartão válida, zera tudo.
        return { value: null, flow: null, baseDescription: result.baseDescription || '', categoryName: null, isInstallment: false, installmentCount: null, cardName: null, closingDay: null, dueDay: null };
    }

    if (result.categoryName && result.flow) {
        const validCategory = categories.find(c => 
            c.name.toLowerCase() === result.categoryName.toLowerCase() && c.category_flow === result.flow
        );
        if (validCategory) {
            result.categoryName = validCategory.name;
        }
    }

    if (result.cardName && cardNames.length > 0) {
        const lowerCaseCardName = result.cardName.toLowerCase();
        // Busca exata primeiro (case-insensitive)
        let foundCard = cardNames.find(c => c.toLowerCase() === lowerCaseCardName);
        // Se não encontrar, tenta uma busca por inclusão (fuzzy)
        if (!foundCard) {
            foundCard = cardNames.find(c => c.toLowerCase().includes(lowerCaseCardName) || lowerCaseCardName.includes(c.toLowerCase()));
        }
        if(foundCard) {
            result.cardName = foundCard;
            logger.info(`[AIService] Nome de cartão "${result.cardName}" normalizado para "${foundCard}".`);
        }
    }

    if (result.flow === 'expense') {
        if (result.isInstallment && (!result.installmentCount || result.installmentCount <= 0)) {
            result.installmentCount = 2;
        } else if (!result.isInstallment) {
            result.installmentCount = null;
        }
    } else {
        result.isInstallment = false;
        result.installmentCount = null;
        result.cardName = null;
    }

    if (result.value !== null) {
        result.value = parseFloat(String(result.value).replace(',', '.'));
        if (isNaN(result.value)) {
            logger.error(`[AIService] IA não conseguiu extrair um valor numérico válido.`);
            result.value = null;
            result.flow = null;
            result.categoryName = null;
        }
    }

    if (result.closingDay) {
        result.closingDay = parseInt(result.closingDay, 10);
        if (isNaN(result.closingDay) || result.closingDay < 1 || result.closingDay > 31) {
            logger.warn(`[AIService] IA sugeriu closingDay inválido. Anulando.`);
            result.closingDay = null;
        }
    }
    if (result.dueDay) {
        result.dueDay = parseInt(result.dueDay, 10);
        if (isNaN(result.dueDay) || result.dueDay < 1 || result.dueDay > 31) {
            logger.warn(`[AIService] IA sugeriu dueDay inválido. Anulando.`);
            result.dueDay = null;
        }
    }

    return result;
  }
}

module.exports = new AIService();