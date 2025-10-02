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
  // Aumentar o timeout para requisições de IA mais complexas (como análise de planilha)
  timeout: 60 * 1000, // 60 segundos
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
      // 1. Salva o buffer do PDF em um arquivo temporário
      fs.writeFileSync(tempPdfPath, pdfBuffer);

      // 2. Opções para a conversão: JPEG, apenas a primeira página
      const options = {
        firstPageToConvert: 1,
        lastPageToConvert: 1,
        jpegFile: true,
      };

      // 3. Executa a conversão
      await poppler.pdfToCairo(tempPdfPath, tempOutputPath, options);
      
      // 4. O nome do arquivo de saída será "tempOutputPath-1.jpg"
      const imagePath = `${tempOutputPath}-1.jpg`;

      // 5. Lê o arquivo de imagem gerado de volta para um buffer
      const imageBuffer = fs.readFileSync(imagePath);
      logger.info('[AIService] PDF convertido para imagem com sucesso.');
      return imageBuffer;
      
    } catch (error) {
      logger.error('[AIService] Erro crítico durante a conversão do PDF com node-poppler.', error);
      return null;
    } finally {
      // 6. Garante que todos os arquivos temporários sejam deletados
      if (fs.existsSync(tempPdfPath)) fs.unlinkSync(tempPdfPath);
      const imagePath = `${tempOutputPath}-1.jpg`;
      if (fs.existsSync(imagePath)) fs.unlinkSync(imagePath);
    }
  }

  /**
   * Analisa um arquivo XLSX (em formato CSV String) para extrair despesas e categorizá-las.
   * @param {string} csvString - O conteúdo da planilha em formato CSV String (Separador: |).
   * @param {Array<string>} categoryList - Lista de nomes de categorias válidas.
   * @returns {Promise<string>} - String JSON com os dados normalizados ou motivo da falha.
   */
  async analyzeExcelStructureAndExtractData(csvString, categoryList) {
    logger.info('[AIService] Iniciando análise de estrutura de planilha...');
    
    const categoryNames = categoryList.map(c => c.trim()).filter(c => c.length > 0);
    const categoryOptions = `"${categoryNames.join('", "')}"`;

    const prompt = `
      Sua tarefa é analisar a planilha CSV (separada por pipe '|') fornecida, identificar a estrutura (quais colunas representam Valor, Data, Descrição e Categoria) e extrair os dados de despesa.
      
      Regras CRÍTICAS:
      1.  A "categoryName" DEVE ser mapeada para uma das categorias existentes: [${categoryOptions}]. Se não houver correspondência clara, use "Outros".
      2.  A "value" deve ser um número (ex: 150.50), sem símbolos de moeda.
      3.  A "date" deve ser convertida para o formato 'YYYY-MM-DD' ou 'YYYY-MM-DDTHH:MM:SSZ' (formato ISO 8601).
      4.  Retorne APENAS um objeto JSON.
      
      Estrutura do retorno JSON:
      {
          "expenses": [
              {
                  "value": number,
                  "date": "YYYY-MM-DD",
                  "description": "string",
                  "categoryName": "string (da lista fornecida)"
              }
              // ... mais despesas
          ],
          "reason": "string (motivo da falha se 'expenses' estiver vazio, ex: 'Nenhuma coluna de valor identificada')"
      }
      
      Planilha CSV (Separador '|'):
      --- PLANILHA INÍCIO ---
      ${csvString}
      --- PLANILHA FIM ---
    `;

    try {
      // Usar a configuração de timeout da instância do OpenAI
      const response = await openai.chat.completions.create({
        model: 'gpt-4o', 
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
      
      // Capturar Erro de Timeout da OpenAI ou HTTP Error
      if (error.status === 400 || error.status === 429) {
          return JSON.stringify({ expenses: [], reason: `Erro da API OpenAI. Código: ${error.status}` });
      }
      
      // Em caso de TIMEOUT (sem status HTTP) ou erro de conexão
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
    
    // CRÍTICO: Buscar categorias APENAS para o Perfil
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