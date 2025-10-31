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
    // <<< INÍCIO DA CORREÇÃO >>>
    // Permite configurar o caminho dos binários do Poppler via variável de ambiente.
    const poppler = new Poppler(process.env.POPPLER_BIN_PATH);
    // <<< FIM DA CORREÇÃO >>>
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
      if (fs.existsSync(imagePath)) fs.existsSync(imagePath);
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
      3.  **Consolidação de Despesas:** Para cada linha com uma DATA e DESCRIÇÃO, se houver um valor em UMA ou mais colunas de CUSTO, gere uma DESPESA SEPARADA para CADA valor de custo.
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
   * Retorna informações detalhadas incluindo parcelamento e cartão. O fluxo (despesa/receita) é determinado pelo sistema posteriormente.
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
    const allCategoryNames = `"${categories.map(c => c.name).join('", "')}"`;

    const creditCardNames = `"${cardNames.join('", "')}"`;
    const base64Image = finalImageBuffer.toString('base64');
    
    const prompt = `
      Você é um especialista em análise de documentos financeiros (comprovantes, notas) e texto.
      Sua missão é extrair informações da IMAGEM e do TEXTO fornecido pelo usuário.

      **Hierarquia de Informação CRÍTICA:**
      1. O **TEXTO DO USUÁRIO** é a fonte de verdade **PRIMÁRIA** para a 'categoryName' e 'baseDescription'.
      2. A **IMAGEM** é a fonte de verdade **PRIMÁRIA** para o 'value' e serve para complementar a descrição.

      Retorne APENAS um objeto JSON válido com as chaves:
      "value" (Número), "baseDescription" (String), "categoryName" (String, pode ser null), 
      "ambiguousCategoryNames" (Array de strings, ou null), "isInstallment" (Booleano), 
      "installmentCount" (Número, se for parcelado), "cardName" (String, se for cartão de crédito).
      
      Regras CRÍTICAS de Extração:
      1.  **Valor:** Extraia o valor monetário principal da **IMAGEM**.
      2.  **Descrição:** A 'baseDescription' deve ser o texto do usuário.
      3.  **CategoryName & Ambiguidade (REGRA MAIS IMPORTANTE):**
          a. Analise o texto do usuário (ex: "cimento", "99freela", "99") e compare-o semanticamente com a lista de categorias existentes: [${allCategoryNames}].
          b. **PRIORIDADE 1: CORRESPONDÊNCIA EXATA.** Se o texto do usuário contiver o NOME EXATO de uma categoria existente (ex: usuário diz "gasolina para o carro" e a categoria "Gasolina" existe), use a categoria "Gasolina". Ignore ambiguidades com outras categorias parciais. Coloque o nome exato em "categoryName" e "ambiguousCategoryNames" como null.
          c. **PRIORIDADE 2: AMBIGUIDADE REAL.** Apenas se o texto do usuário for curto e corresponder a MÚLTIPLAS categorias (ex: usuário diz "99", e existem "99pop" e "99freelas"), coloque "categoryName" como null e popule "ambiguousCategoryNames" com os nomes exatos das categorias correspondentes (ex: ["99pop", "99freelas"]). Este caso deve ser RARO.
          d. **PRIORIDADE 3: NOVA CATEGORIA.** Se NENHUMA categoria existente corresponder, coloque o termo principal do usuário em "categoryName" para sinalizar uma nova categoria e deixe "ambiguousCategoryNames" como null.
          e. **FALLBACK:** Se o texto não fornecer nenhuma pista de categoria, use "Outros" em "categoryName".
      4.  **Parcelamento e Cartão:** Extraia 'isInstallment', 'installmentCount', e 'cardName' com base no texto e na imagem.

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
   * Analisa um texto puro (mensagem de WhatsApp) para extrair informações de lançamento.
   * O fluxo (despesa/receita) é determinado pelo sistema posteriormente.
   */
  async analyzeTextForExpenseOrRevenue(userText, profileId, cardNames = []) {
    logger.info(`[AIService] Iniciando análise de texto puro: "${userText}"`);

    const categories = await Category.findAll({ where: { profile_id: profileId }, attributes: ['name', 'category_flow'] }); 
    const allCategoryNames = `"${categories.map(c => c.name).join('", "')}"`;

    const creditCardNames = `"${cardNames.join('", "')}"`;

    const prompt = `
      Você é um especialista em análise de texto financeiro para um bot de WhatsApp.
      Retorne APENAS um objeto JSON válido com as chaves:
      "value" (Número, ou null), "baseDescription" (String), "categoryName" (String, ou null), 
      "ambiguousCategoryNames" (Array de strings, ou null), "isInstallment" (Booleano), 
      "installmentCount" (Número, se parcelado), "cardName" (String, se for cartão de crédito), 
      "closingDay" (Número), "dueDay" (Número).
      
      Regras CRÍTICAS:
      1.  **Cenário 1: Lançamento Financeiro.**
          *   Sua missão é identificar o "categoryName" com base no texto do usuário e na lista de categorias: [${allCategoryNames}]. O sistema definirá se é despesa ou receita baseado na sua escolha.
          *   **CategoryName & Ambiguidade (REGRA MAIS IMPORTANTE):**
              a. **PRIORIDADE 1: CORRESPONDÊNCIA EXATA.** Se o texto do usuário contiver o NOME EXATO de uma categoria existente (ex: usuário diz "gasolina para o carro" e a categoria "Gasolina" existe), use a categoria "Gasolina". Coloque o nome exato em "categoryName" e "ambiguousCategoryNames" como null.
              b. **PRIORIDADE 2: AMBIGUIDADE REAL.** Apenas se o termo do usuário for curto e corresponder a MÚLTIPLAS categorias (ex: "99" e existem "99pop" e "99freelas"), coloque "categoryName" como null e popule "ambiguousCategoryNames" com os nomes exatos. Este caso deve ser RARO.
              c. **PRIORIDADE 3: NOVA CATEGORIA.** Se NENHUMA categoria existente corresponder semanticamente, coloque o termo principal do usuário em "categoryName" para sinalizar uma nova categoria.
              d. **FALLBACK:** Se o texto não der pista de categoria, use "Outros" em "categoryName".
          *   Popule os demais campos (value, baseDescription, isInstallment, etc.) normalmente.

      2.  **Cenário 2: Criação de Cartão.**
          *   Se o texto contém "criar cartão", "novo cartão", etc.
          *   Todos os campos de lançamento devem ser null.
          *   Popule "cardName", "closingDay", e "dueDay".

      3.  **Ambiguidade Geral:** Se for ambíguo, priorize o Cenário 1. Se nenhum se encaixar, retorne todos os campos como null, exceto "baseDescription" com o texto original.

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
    // Se não for um lançamento de valor e nem uma criação de cartão válida, zera tudo.
    if (result.value === null && (!result.cardName || !result.closingDay || !result.dueDay)) {
        return { value: null, baseDescription: result.baseDescription || '', categoryName: null, isInstallment: false, installmentCount: null, cardName: null, closingDay: null, dueDay: null, ambiguousCategoryNames: null };
    }

    if (result.cardName && cardNames.length > 0) {
        const lowerCaseCardName = result.cardName.toLowerCase();
        let foundCard = cardNames.find(c => c.toLowerCase() === lowerCaseCardName);
        if (!foundCard) {
            foundCard = cardNames.find(c => c.toLowerCase().includes(lowerCaseCardName) || lowerCaseCardName.includes(c.toLowerCase()));
        }
        if(foundCard) {
            result.cardName = foundCard;
            logger.info(`[AIService] Nome de cartão "${result.cardName}" normalizado para "${foundCard}".`);
        }
    }

    if (result.isInstallment && (!result.installmentCount || result.installmentCount <= 0)) {
        result.installmentCount = 2; // Default
    } else if (!result.isInstallment) {
        result.installmentCount = null;
    }

    if (result.value !== null) {
        result.value = parseFloat(String(result.value).replace(',', '.'));
        if (isNaN(result.value)) {
            logger.error(`[AIService] IA não conseguiu extrair um valor numérico válido.`);
            result.value = null;
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