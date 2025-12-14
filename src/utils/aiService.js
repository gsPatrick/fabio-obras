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
  timeout: 60 * 1000, // 60 segundos de timeout
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
    // Caminho dos binários do Poppler (configurável via ENV ou padrão do sistema)
    const poppler = new Poppler(process.env.POPPLER_BIN_PATH);

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

      if (fs.existsSync(imagePath)) {
        const imageBuffer = fs.readFileSync(imagePath);
        logger.info('[AIService] PDF convertido para imagem com sucesso.');

        // Limpeza
        fs.unlinkSync(imagePath);
        fs.unlinkSync(tempPdfPath);

        return imageBuffer;
      } else {
        throw new Error("Arquivo de imagem não gerado pelo Poppler.");
      }

    } catch (error) {
      logger.error('[AIService] Erro crítico durante a conversão do PDF com node-poppler.', error);
      if (fs.existsSync(tempPdfPath)) fs.unlinkSync(tempPdfPath);
      return null;
    }
  }

  /**
   * Pesquisa na internet para entender o que é um termo desconhecido e categorizar.
   * Usa a OpenAI Responses API com web_search tool.
   * @param {string} unknownTerm - O termo que a IA não reconheceu
   * @param {string[]} categoryNames - Lista de categorias existentes do usuário
   * @returns {Object} - { categoryName, confidence, reason }
   */
  async searchWebAndCategorize(unknownTerm, categoryNames) {
    logger.info(`[AIService] Pesquisando na internet: "${unknownTerm}"`);

    const categoryList = categoryNames.map(c => `"${c}"`).join(', ');

    const prompt = `Eu tenho as seguintes categorias de gastos: [${categoryList}]

O usuário mencionou "${unknownTerm}" em uma despesa. Eu não conheço esse termo.

Por favor, pesquise na internet o que é "${unknownTerm}" e me diga:
1. O que é esse termo/produto/serviço
2. Qual categoria existente da minha lista melhor se encaixa

Responda em JSON:
{
  "whatItIs": "breve descrição do que é",
  "categoryName": "nome da categoria existente que melhor se encaixa (ou null se nenhuma)",
  "categoryMatchConfidence": "high|medium|low",
  "categoryMatchReason": "explicação da associação"
}`;

    try {
      // Usando a Responses API com web_search tool
      const response = await openai.responses.create({
        model: 'gpt-4o',
        tools: [{ type: 'web_search' }],
        input: prompt,
      });

      // Extrair o texto da resposta
      let responseText = '';
      if (response.output) {
        for (const item of response.output) {
          if (item.type === 'message' && item.content) {
            for (const content of item.content) {
              if (content.type === 'output_text') {
                responseText = content.text;
              }
            }
          }
        }
      }

      // Tentar parsear JSON da resposta
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const result = JSON.parse(jsonMatch[0]);
        logger.info(`[AIService] Busca web concluída: ${unknownTerm} → ${result.categoryName}`, result);
        return result;
      }

      logger.warn('[AIService] Busca web não retornou JSON válido');
      return { categoryName: null, categoryMatchConfidence: 'low', categoryMatchReason: 'Busca não conclusiva' };

    } catch (error) {
      // Se a Responses API falhar (versão antiga do SDK), tenta fallback
      if (error.message?.includes('responses') || error.message?.includes('not a function')) {
        logger.warn('[AIService] Responses API não disponível, usando fallback com chat completions');
        return this._searchWebFallback(unknownTerm, categoryNames);
      }
      logger.error('[AIService] Erro na busca web:', error);
      return { categoryName: null, categoryMatchConfidence: 'low', categoryMatchReason: `Erro: ${error.message}` };
    }
  }

  /**
   * Fallback para busca web usando chat completions (sem busca real, apenas conhecimento do modelo)
   */
  async _searchWebFallback(unknownTerm, categoryNames) {
    logger.info(`[AIService] Fallback: tentando categorizar "${unknownTerm}" com conhecimento do modelo`);

    const categoryList = categoryNames.map(c => `"${c}"`).join(', ');

    const prompt = `Você é um especialista em categorização de gastos com conhecimento amplo sobre marcas, produtos e serviços.

TERMO DO USUÁRIO: "${unknownTerm}"
CATEGORIAS EXISTENTES: [${categoryList}]

Use todo seu conhecimento para identificar o que é "${unknownTerm}" e qual categoria existente melhor se encaixa.

Exemplos de associações:
- Se for uma marca de remédio/medicamento → Farmácia ou Saúde
- Se for uma empresa/app de streaming → Entretenimento ou Assinaturas
- Se for uma marca de comida/restaurante → Alimentação ou Restaurante
- Se for um serviço de cloud/hosting → Tecnologia ou Assinaturas
- Se for uma marca de roupa/calçado → Vestuário ou Roupas

Responda APENAS em JSON:
{
  "whatItIs": "breve descrição do que é",
  "categoryName": "nome EXATO de uma categoria da lista (ou null se nenhuma encaixa)",
  "categoryMatchConfidence": "high|medium|low",
  "categoryMatchReason": "explicação"
}`;

    try {
      const response = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: "json_object" },
        temperature: 0.2,
      });

      const result = JSON.parse(response.choices[0].message.content);
      logger.info(`[AIService] Fallback concluído: ${unknownTerm} → ${result.categoryName}`, result);
      return result;
    } catch (error) {
      logger.error('[AIService] Erro no fallback:', error);
      return { categoryName: null, categoryMatchConfidence: 'low', categoryMatchReason: `Erro: ${error.message}` };
    }
  }

  /**
   * Analisa um arquivo XLSX (em formato CSV String) para extrair despesas.
   */
  async analyzeExcelStructureAndExtractData(csvString, categoryList) {
    logger.info('[AIService] Iniciando análise de estrutura de planilha...');

    const expenseCategoryNames = categoryList.join('", "');
    const expenseCategoryOptions = `"${expenseCategoryNames}"`;

    const prompt = `
      Você é um especialista em análise de dados financeiros.
      Analise o CSV abaixo e extraia as despesas.
      
      Regras:
      1. Identifique colunas de Data, Descrição e Valor (Saída/Custo).
      2. Ignore entradas/receitas.
      3. Mapeie cada linha para uma categoria da lista: [${expenseCategoryOptions}]. Se não houver correspondência clara, use "Outros".
      4. Retorne JSON: { "expenses": [{ "date": "YYYY-MM-DD", "description": "string", "value": number, "categoryName": "string" }], "reason": "string se falhar" }
      
      CSV:
      ${csvString.substring(0, 15000)} 
    `;
    // Limitamos caracteres do CSV para não estourar token se for gigante

    try {
      const response = await openai.chat.completions.create({
        model: 'gpt-3.5-turbo-0125',
        messages: [{
          role: 'user',
          content: [{ type: 'text', text: prompt }],
        }],
        response_format: { type: "json_object" },
        temperature: 0,
      });

      return response.choices[0].message.content;
    } catch (error) {
      logger.error('[AIService] Erro na análise de planilha:', error);
      return JSON.stringify({ expenses: [], reason: `Erro API OpenAI: ${error.message}` });
    }
  }

  /**
   * Analisa um comprovante (imagem ou PDF) e um texto de contexto.
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
    const allCategoryNames = categories.map(c => `"${c.name}"`).join(', ');
    const base64Image = finalImageBuffer.toString('base64');

    const prompt = `
      Analise esta imagem de comprovante/nota e o texto do usuário: "${userText || ''}".

      LISTA DE CATEGORIAS DO USUÁRIO: [${allCategoryNames}]

      REGRAS DE CATEGORIZAÇÃO INTELIGENTE (VOCÊ DEVE SER MUITO ESPERTO!):
      
      1. **Valor:** Extraia o valor total da imagem.
      2. **Descrição:** Use o texto do usuário como descrição base. Se vazio, use o nome do estabelecimento.
      
      3. **CATEGORIZAÇÃO COM INTELIGÊNCIA SEMÂNTICA (CRÍTICO):**
         Use seu conhecimento sobre o mundo para SEMPRE encontrar a melhor categoria existente:
         
         EXEMPLOS DE ASSOCIAÇÕES QUE VOCÊ DEVE FAZER:
         - "remédio", "medicamento", "dipirona", "paracetamol", "tylenol" → busque "Farmácia" ou "Saúde"
         - "chiclete", "bala", "chocolate", "brigadeiro" → busque "Doces" ou "Mercado" 
         - "uber", "99", "táxi", "cabify" → busque "Transporte"
         - "pizza", "hambúrguer", "restaurante", "ifood", "almoço", "jantar" → busque "Alimentação" ou "Restaurante"
         - "Netflix", "Spotify", "Disney+", "HBO", "Amazon Prime" → busque "Entretenimento" ou "Streaming" ou "Assinaturas"
         - "gasolina", "álcool", "combustível", "posto" → busque "Combustível" ou "Transporte"
         - "luz", "energia", "CPFL", "Enel" → busque "Conta de Luz" ou "Contas" ou "Utilidades"
         - "água", "SABESP" → busque "Conta de Água" ou "Contas"
         - "internet", "Vivo", "Claro", "Tim" → busque "Internet" ou "Telefone" ou "Contas"
         
         USE SEU CONHECIMENTO GERAL: Se o usuário digita uma marca/produto/serviço que você conhece,
         associe à categoria mais adequada que exista na lista do usuário.
         
      4. **CONFIANÇA DO MATCH:**
         - "high": Categoria existe E é match perfeito (ex: "Farmácia" para "remédio")
         - "medium": Categoria existe E é semanticamente relacionada (ex: "Mercado" para "chiclete")  
         - "low": Nenhuma categoria existente se encaixa bem
         
      5. **SE NENHUMA CATEGORIA SE ENCAIXA:** 
         Retorne o termo principal do usuário em categoryName e confidence "low".

      Retorne JSON:
      {
          "value": number, 
          "baseDescription": "string", 
          "categoryName": "string (categoria existente que melhor se encaixa OU termo do usuário)", 
          "categoryMatchConfidence": "high|medium|low",
          "categoryMatchReason": "string explicando por que escolheu essa categoria",
          "isInstallment": boolean, 
          "installmentCount": number, 
          "cardName": "string (se identificado)"
      }
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
        temperature: 0.1, // Leve criatividade para associações semânticas
      });

      const result = JSON.parse(response.choices[0].message.content);
      logger.info('[AIService] Análise detalhada com imagem concluída.', result);
      return this._validateAnalysisResult(result, categories, cardNames);
    } catch (error) {
      logger.error('[AIService] Erro na análise detalhada:', error);
      return null;
    }
  }

  /**
   * Analisa um texto puro (mensagem de WhatsApp).
   */
  async analyzeTextForExpenseOrRevenue(userText, profileId, cardNames = []) {
    logger.info(`[AIService] Iniciando análise de texto puro: "${userText}"`);

    const categories = await Category.findAll({ where: { profile_id: profileId }, attributes: ['name', 'category_flow'] });
    const allCategoryNames = categories.map(c => `"${c.name}"`).join(', ');
    const creditCardNames = `"${cardNames.join('", "')}"`;

    const prompt = `
      Você é um assistente SUPER INTELIGENTE de categorização de gastos.
      
      MENSAGEM DO USUÁRIO: "${userText}"
      CATEGORIAS EXISTENTES NO BANCO: [${allCategoryNames}]
      CARTÕES: [${creditCardNames}]

      SUA MISSÃO:
      1. Extrair o valor monetário.
      2. Extrair a descrição.
      3. Escolher a MELHOR categoria existente usando INTELIGÊNCIA SEMÂNTICA.

      REGRAS DE CATEGORIZAÇÃO INTELIGENTE (VOCÊ DEVE SER MUITO ESPERTO!):
      
      Use seu conhecimento sobre o mundo para SEMPRE encontrar a melhor categoria existente:
      
      EXEMPLOS DE ASSOCIAÇÕES QUE VOCÊ DEVE FAZER:
      - "remédio", "medicamento", "dipirona", "paracetamol", "tylenol", "drogaria" → busque "Farmácia" ou "Saúde"
      - "chiclete", "bala", "chocolate", "brigadeiro", "sorvete" → busque "Doces" ou "Mercado" ou "Alimentação"
      - "uber", "99", "táxi", "cabify", "corrida" → busque "Transporte"
      - "pizza", "hambúrguer", "restaurante", "ifood", "almoço", "jantar", "lanche" → busque "Alimentação" ou "Restaurante"
      - "Netflix", "Spotify", "Disney+", "HBO", "Amazon Prime", "YouTube Premium" → busque "Entretenimento" ou "Streaming" ou "Assinaturas"
      - "AWS", "Google Cloud", "Azure", "servidor", "hospedagem" → busque "Tecnologia" ou "Serviços" ou "Assinaturas"
      - "gasolina", "álcool", "combustível", "posto", "abastecimento" → busque "Combustível" ou "Transporte"
      - "luz", "energia", "CPFL", "Enel", "conta de luz" → busque "Conta de Luz" ou "Contas" ou "Utilidades"
      - "água", "SABESP", "conta de água" → busque "Conta de Água" ou "Contas"
      - "internet", "Vivo", "Claro", "Tim", "celular" → busque "Internet" ou "Telefone" ou "Contas"
      - "supermercado", "compras", "feira", "hortifruti" → busque "Mercado" ou "Supermercado"
      - "roupa", "camisa", "calça", "tênis", "sapato" → busque "Vestuário" ou "Roupas" ou "Compras"
      
      USE SEU CONHECIMENTO GERAL: Se o usuário digita uma marca/produto/serviço que você conhece,
      associe à categoria mais adequada que exista na lista do usuário.
      
      **CONFIANÇA DO MATCH:**
      - "high": Categoria existe E é match perfeito (ex: "Farmácia" para "remédio")
      - "medium": Categoria existe E é semanticamente relacionada (ex: "Mercado" para "chiclete")  
      - "low": Nenhuma categoria existente se encaixa bem
      
      **SE NENHUMA CATEGORIA SE ENCAIXA:** 
      Retorne o termo principal do usuário em categoryName e confidence "low".
      
      CENÁRIO CARTÃO: Se a mensagem for "criar cartão Nubank dia 5", ignore o valor e preencha cardName, closingDay e dueDay.

      Retorne JSON:
      {
        "value": number | null,
        "baseDescription": "string",
        "categoryName": "string (categoria existente que melhor se encaixa OU termo do usuário)",
        "categoryMatchConfidence": "high|medium|low",
        "categoryMatchReason": "string explicando por que escolheu essa categoria",
        "isInstallment": boolean,
        "installmentCount": number | null,
        "cardName": string | null,
        "closingDay": number | null,
        "dueDay": number | null
      }
    `;

    try {
      const response = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [{
          role: 'user',
          content: [{ type: 'text', text: prompt }],
        }],
        response_format: { type: "json_object" },
        temperature: 0.1, // Leve criatividade para associações semânticas
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
    // Validação básica para não retornar lixo
    if (result.value === null && (!result.cardName || !result.closingDay)) {
      // Se não tem valor e não é criação de cartão, retorna nulo/vazio seguro
      return { value: null, baseDescription: result.baseDescription || '', categoryName: null, isInstallment: false, installmentCount: null, cardName: null, closingDay: null, dueDay: null, ambiguousCategoryNames: null };
    }

    // Normaliza nome do cartão se encontrado
    if (result.cardName && cardNames.length > 0) {
      const lowerCaseCardName = result.cardName.toLowerCase();
      let foundCard = cardNames.find(c => c.toLowerCase() === lowerCaseCardName);
      if (!foundCard) {
        foundCard = cardNames.find(c => c.toLowerCase().includes(lowerCaseCardName) || lowerCaseCardName.includes(c.toLowerCase()));
      }
      if (foundCard) {
        result.cardName = foundCard;
      }
    }

    // Valida parcelas
    if (result.isInstallment && (!result.installmentCount || result.installmentCount <= 0)) {
      result.installmentCount = 2; // Default seguro
    } else if (!result.isInstallment) {
      result.installmentCount = null;
    }

    // Corrige formato numérico
    if (result.value !== null) {
      // Remove R$, espaços e troca vírgula por ponto se necessário (embora a IA já devolva number geralmente)
      const valStr = String(result.value).replace(/[^0-9.,-]/g, '').replace(',', '.');
      result.value = parseFloat(valStr);
      if (isNaN(result.value)) {
        result.value = null;
        result.categoryName = null;
      }
    }

    return result;
  }
}

module.exports = new AIService();