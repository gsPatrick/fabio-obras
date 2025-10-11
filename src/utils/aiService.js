// src/utils/aiService.js
'use strict';

require('dotenv').config();
const OpenAI = require('openai');
const logger = require('./logger');
const { Category, CreditCard } = require('../models'); // Adicionado CreditCard
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
    
    // categoryList agora pode ter category_flow
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
  async analyzeExpenseWithImage(mediaBuffer, userText, mimeType = 'image/jpeg', profileId) { 
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
    
    // Usando o profileId para buscar as categorias do perfil correto.
    const categories = await Category.findAll({ where: { profile_id: profileId }, attributes: ['name', 'category_flow'] }); 
    const expenseCategoryList = `"${categories.filter(c => c.category_flow === 'expense').map(c => c.name).join('", "')}"`;
    const revenueCategoryList = `"${categories.filter(c => c.category_flow === 'revenue').map(c => c.name).join('", "')}"`;

    // Busca cartões de crédito para o perfil
    const creditCards = await CreditCard.findAll({ where: { profile_id: profileId, is_active: true }, attributes: ['name'] });
    const creditCardNames = `"${creditCards.map(c => c.name).join('", "')}"`;

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
      3.  **CategoryName:** DEVE ser uma das categorias de DESPESA existentes: [${expenseCategoryList}] OU uma das categorias de RECEITA existentes: [${revenueCategoryList}]. Use "Outros" para despesas ou "Receita Padrão" para receitas se não houver mapeamento claro.
      4.  **isInstallment:** Se a despesa for parcelada (ex: "3x", "parcelado", "prestação"), defina como true.
      5.  **installmentCount:** Se for parcelado, extraia o número total de parcelas (ex: "3" de "3x").
      6.  **cardName:** Se a despesa for de cartão de crédito, identifique o nome do cartão entre as opções: [${creditCardNames}].
      7.  **closingDay e dueDay (para criação/atualização de cartão):** Se o texto mencionar explicitamente termos como "dia de fechamento do cartão é dia X" ou "vencimento do cartão é dia Y", extraia esses números. Caso contrário, use null. Estes são importantes para o fluxo de criação de cartão via WhatsApp.
      
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
      // Valida resultado com categorias de despesa E receita
      return this._validateAnalysisResult(result, categories);
    } catch (error) {
      logger.error('[AIService] Erro na análise detalhada:', error);
      return null;
    }
  }

  // NOVO MÉTODO: analyzeTextForExpenseOrRevenue
  /**
   * Analisa um texto puro (mensagem de WhatsApp) para extrair despesas ou receitas, parcelamento e cartão.
   * Retorna informações detalhadas, incluindo dias de fechamento/vencimento se aplicável à criação de cartão.
   */
  async analyzeTextForExpenseOrRevenue(userText, profileId) {
    logger.info(`[AIService] Iniciando análise de texto puro: "${userText}"`);

    const categories = await Category.findAll({ where: { profile_id: profileId }, attributes: ['name', 'category_flow'] }); 
    const expenseCategoryList = `"${categories.filter(c => c.category_flow === 'expense').map(c => c.name).join('", "')}"`;
    const revenueCategoryList = `"${categories.filter(c => c.category_flow === 'revenue').map(c => c.name).join('", "')}"`;

    const creditCards = await CreditCard.findAll({ where: { profile_id: profileId, is_active: true }, attributes: ['name'] });
    const creditCardNames = `"${creditCards.map(c => c.name).join('", "')}"`;

    const prompt = `
      Você é um especialista em análise de texto financeiro. Sua tarefa é analisar a mensagem de texto do usuário e extrair as informações de despesa ou receita.
      Retorne APENAS um objeto JSON válido com as chaves:
      "value" (Número, ou null se não for um lançamento de despesa/receita),
      "flow" (String: 'expense' ou 'revenue', ou null se não for um lançamento),
      "baseDescription" (String),
      "categoryName" (String, ou null se não for um lançamento),
      "isInstallment" (Booleano),
      "installmentCount" (Número, se for parcelado),
      "cardName" (String, se for cartão de crédito),
      "closingDay" (Número do dia do mês, se o texto mencionar "fechamento do cartão" ou "melhor dia de compra" e um número),
      "dueDay" (Número do dia do mês, se o texto mencionar "vencimento do cartão" e um número).
      
      Regras CRÍTICAS:
      1.  **Prioridade:** Tente identificar primeiro se é um lançamento de despesa/receita. Se sim, "value", "flow" e "categoryName" são essenciais.
      2.  **Lançamento de Despesa/Receita:**
          *   **Valor:** O valor é obrigatório para lançamentos. Extraia o valor monetário. Se o texto indicar "salário", "recebi", "entrada", o "flow" é 'revenue'. Se for "paguei", "gastei", "comprei", "despesa", o "flow" é 'expense'.
          *   **Flow:** Determine 'expense' ou 'revenue' com base nas palavras-chave e no contexto. Priorize 'expense' se não for claro.
          *   **CategoryName:** DEVE ser uma das categorias de DESPESA existentes: [${expenseCategoryList}] OU uma das categorias de RECEITA existentes: [${revenueCategoryList}]. Use "Outros" para despesas ou "Receita Padrão" para receitas se não houver mapeamento claro.
          *   **isInstallment:** Se a despesa for parcelada (ex: "3x", "parcelado"), defina como true.
          *   **installmentCount:** Se for parcelado, extraia o número total de parcelas (ex: "3" de "3x"). Se não indicado mas "parcelado", use 2.
          *   **cardName:** Se o texto mencionar um cartão de crédito, identifique o nome do cartão entre as opções: [${creditCardNames}].
      3.  **Criação/Atualização de Cartão (Sem Lançamento Direto):**
          *   Se o texto não for um lançamento (sem valor monetário claro ou descrição de compra/recebimento), mas mencionar "criar cartão", "configurar cartão", "novo cartão", procure por "nome do cartão", "fechamento dia X", "vencimento dia Y". Nestes casos, "value", "flow", "categoryName" podem ser null.
          *   **closingDay e dueDay:** Se o texto mencionar explicitamente "dia de fechamento do cartão é dia X" ou "vencimento do cartão é dia Y", extraia esses números. Caso contrário, use null.
      4.  **Formato:** O usuário pode enviar "500 aluguel" ou "salário 3000 categoria salário" ou "criar cartão nubank fechamento dia 10 vencimento dia 20".

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
        temperature: 0.2, 
      });

      const result = JSON.parse(response.choices[0].message.content);
      logger.info('[AIService] Análise de texto puro concluída.', result);
      // Valida resultado com categorias de despesa E receita
      return this._validateAnalysisResult(result, categories);
    } catch (error) {
      logger.error('[AIService] Erro na análise de texto puro:', error);
      return null;
    }
  }
  // FIM NOVO MÉTODO

  // MODIFICADO: _validateAnalysisResult para CategoryFlow e CardName
  _validateAnalysisResult(result, categories) {
    const defaultExpenseCategory = 'Outros';
    const defaultRevenueCategory = 'Receita Padrão';
    
    // Garante que 'flow' seja 'expense' ou 'revenue' se houver valor, ou null se não for lançamento
    if (result.value !== null) { // Só valida flow se houver um valor a ser lançado
        if (!result.flow || !['expense', 'revenue'].includes(result.flow)) {
            result.flow = 'expense'; // Padrão para despesa se não identificado em lançamento
            logger.warn(`[AIService] IA sugeriu fluxo inválido/vazio ('${result.flow}') para lançamento. Usando 'expense'.`);
        }
    } else {
        result.flow = null; // Não é um lançamento se não tem valor
        result.categoryName = null; // E sem categoria
    }


    // Valida e ajusta categoryName APENAS se for um lançamento
    if (result.categoryName !== null && result.flow !== null) {
        const validCategory = categories.find(c => 
            c.name.toLowerCase() === result.categoryName.toLowerCase() && c.category_flow === result.flow
        );

        if (!validCategory) {
          const defaultCategoryName = result.flow === 'expense' ? defaultExpenseCategory : defaultRevenueCategory;
          logger.warn(`[AIService] IA sugeriu categoria inválida/vazia ('${result.categoryName}') para o fluxo '${result.flow}'. Usando '${defaultCategoryName}'.`);
          result.categoryName = defaultCategoryName;
        } else {
            result.categoryName = validCategory.name; // Garante o casing correto da categoria existente
        }
    } else {
        result.categoryName = null; // Garante que categoryName é null se não é lançamento
    }


    // Valida isInstallment e installmentCount
    if (result.flow === 'expense') { // Parcelamento só faz sentido para despesas
        if (result.isInstallment && (!result.installmentCount || result.installmentCount <= 0)) {
            result.installmentCount = 2; // Padrão de 2x se a IA disser que é parcelado mas não der o número
        } else if (!result.isInstallment) {
            result.installmentCount = null;
        }
    } else { // Para receitas ou não lançamentos, não há parcelamento
        result.isInstallment = false;
        result.installmentCount = null;
    }


    // Valida cardName (apenas para despesas)
    if (result.flow !== 'expense' && result.cardName) {
        result.cardName = null; // Receita não deve estar associada a cartão de crédito
        logger.warn(`[AIService] IA sugeriu cartão para uma receita ou não lançamento. Ignorando.`);
    }

    // Garante que o valor seja um número, se existir
    if (result.value !== null) {
        result.value = parseFloat(result.value);
        if (isNaN(result.value)) {
            logger.error(`[AIService] IA não conseguiu extrair um valor numérico válido para lançamento.`);
            result.value = null; // Anula o valor se for inválido
            result.flow = null; // E anula o fluxo, pois não pode ser um lançamento sem valor
            result.categoryName = null;
        }
    }

    // Valida closingDay e dueDay
    if (result.closingDay) {
        result.closingDay = parseInt(result.closingDay, 10);
        if (isNaN(result.closingDay) || result.closingDay < 1 || result.closingDay > 31) {
            logger.warn(`[AIService] IA sugeriu closingDay inválido (${result.closingDay}). Anulando.`);
            result.closingDay = null;
        }
    }
    if (result.dueDay) {
        result.dueDay = parseInt(result.dueDay, 10);
        if (isNaN(result.dueDay) || result.dueDay < 1 || result.dueDay > 31) {
            logger.warn(`[AIService] IA sugeriu dueDay inválido (${result.dueDay}). Anulando.`);
            result.dueDay = null;
        }
    }

    return result;
  }
}

module.exports = new AIService();