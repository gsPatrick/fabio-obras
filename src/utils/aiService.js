// src/utils/aiService.js
'use strict';

require('dotenv').config();
const OpenAI = require('openai');
const logger = require('./logger');
const { Category } = require('../models');
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
    
    const categoryNames = categoryList.map(c => c.trim()).filter(c => c.length > 0);
    const categoryOptions = `"${categoryNames.join('", "')}"`;

    const prompt = `
      Você é um especialista em análise de planilhas financeiras de CUSTOS (despesas). Sua missão é extrair dados de despesas de forma universal de uma planilha CSV (separada por pipe '|') desestruturada.
      
      Regras CRÍTICAS Universais:
      1.  **Foco em Custos:** Ignore qualquer coluna ou valor que represente 'ENTRADA', 'RECEITA', ou valores positivos que não sejam despesas (a menos que a descrição indique um custo). **O sistema é APENAS para despesas.**
      2.  **Identificação de Colunas:** A coluna de Valor de CUSTO é a que contém a maioria dos números monetários de SAÍDA. A coluna de Data é a que contém o formato de data mais consistente. A coluna de Descrição é a que possui o texto mais descritivo.
      3.  **Consolidação de Despesas:** Para cada linha com uma DATA e DESCRIÇÃO, se houver um valor em UMA ou MAIS colunas de CUSTO, gere uma DESPESA SEPARADA para CADA valor de custo.
      4.  **Descrição Final:** A descrição deve ser a DESCRIÇÃO ORIGINAL CONCATENADA com o NOME DO CABEÇALHO DA COLUNA DE CUSTO (Ex: 'COMPRA DE CIMENTO - FABIO').
      5.  **Data:** Converta para o formato 'YYYY-MM-DD'. Use o ano atual (ou o ano mais provável, como 2024/2025) se o ano não estiver especificado (Ex: '12-abr.' -> '2025-04-12').
      6.  **Categorização:** Mapeie para uma das categorias existentes: [${categoryOptions}]. Use "Outros" se não houver mapeamento claro.
      
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
    
    // AQUI ESTÁ A CORREÇÃO: Usando o profileId para buscar as categorias do perfil correto.
    const categories = await Category.findAll({ where: { profile_id: profileId }, attributes: ['name'] }); 
    const categoryList = `"${categories.map(c => c.name).join('", "')}"`;
    const base64Image = finalImageBuffer.toString('base64');
    
    const prompt = `
      Sua tarefa é analisar a imagem de um documento financeiro e um texto complementar fornecido pelo usuário.
      Extraia as informações e retorne APENAS um objeto JSON válido com as chaves:
      "value" (Número), "documentType" (String), "payer" (String), "receiver" (String), "baseDescription" (String), "categoryName" (String).
      A "categoryName" DEVE ser uma das seguintes opções: [${categoryList}].
      Contexto do usuário (use para definir a categoria): "${userText || 'Nenhum'}"
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
      return this._validateAnalysisResult(result, categories.map(c => c.name));
    } catch (error) {
      logger.error('[AIService] Erro na análise detalhada:', error);
      return null;
    }
  }

  _validateAnalysisResult(result, categoryArray) {
    if (!result.categoryName || !categoryArray.includes(result.categoryName)) {
      logger.warn(`[AIService] IA sugeriu categoria inválida/vazia ('${result.categoryName}'). Usando 'Outros'.`);
      result.categoryName = 'Outros';
    }
    return result;
  }
}

module.exports = new AIService();