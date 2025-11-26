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

      REGRAS RÍGIDAS DE EXTRAÇÃO:
      1. **Valor:** Extraia o valor total da imagem.
      2. **Descrição:** Use o texto do usuário como descrição base. Se vazio, use o nome do estabelecimento.
      3. **CATEGORIZAÇÃO (CRÍTICO):**
         - Se o texto do usuário ou o item da imagem for **EXATAMENTE IGUAL** a uma categoria da lista (ignorando maiúsculas), use-a.
         - Se for um sinônimo óbvio (ex: "Uber" -> "Transporte"), use-a.
         - **PROIBIDO ADIVINHAR:** Se o usuário digitou um termo (ex: "Servidor", "Vinho") e não existe essa categoria exata, **NÃO TENTE ASSOCIAR** a categorias não relacionadas (como associar "Servidor" a "Desenvolvedor").
         - **AÇÃO PADRÃO:** Se não houver match exato, retorne o termo principal do usuário (ex: "Servidor") no campo 'categoryName'. Isso fará o sistema sugerir a criação dessa categoria.

      Retorne JSON:
      {
          "value": number, 
          "baseDescription": "string", 
          "categoryName": "string", 
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
        temperature: 0, // ZERO criatividade
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
      Você é um extrator de dados estritamente literal.
      
      MENSAGEM DO USUÁRIO: "${userText}"
      CATEGORIAS EXISTENTES NO BANCO: [${allCategoryNames}]
      CARTÕES: [${creditCardNames}]

      SUA MISSÃO:
      1. Extrair o valor monetário.
      2. Extrair a descrição.
      3. Definir o 'categoryName'.

      REGRAS DE OURO PARA 'categoryName':
      - **REGRA 1 (Match Exato):** Se o usuário digitou uma palavra que existe na lista de categorias (ex: digitou "Mercado" e existe "MERCADO"), use a categoria existente.
      - **REGRA 2 (Sem Relações Indiretas):** Se o usuário digitou algo que NÃO está na lista (ex: "Servidor"), **NÃO** tente associar a uma categoria de pessoa ou profissão (ex: NÃO coloque em "Patrick.Developer").
      - **REGRA 3 (Criação):** Se não houver match exato ou sinônimo universal (ex: Uber=Transporte), retorne a palavra chave do usuário (ex: "Servidor") no 'categoryName'. É preferível sugerir criar uma nova categoria do que errar a associação.
      
      CENÁRIO CARTÃO: Se a mensagem for "criar cartão Nubank dia 5", ignore o valor e preencha cardName, closingDay e dueDay.

      Retorne JSON:
      {
        "value": number | null,
        "baseDescription": "string",
        "categoryName": "string (Categoria existente ou a palavra chave do usuário)",
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
        temperature: 0, // ZERO criatividade para evitar alucinações de categoria
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
        if(foundCard) {
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