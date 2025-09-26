// src/utils/aiService.js
'use strict';

require('dotenv').config();
const OpenAI = require('openai');
const logger = require('./logger');
const { Category } = require('../models');
const fs = require('fs');
const path = require('path');
const os = require('os');
// <<< MUDANÇA 1: Importamos a nova biblioteca >>>
const Poppler = require('node-poppler');

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
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
   * <<< MUDANÇA 2: Lógica totalmente reescrita para usar node-poppler >>>
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
   * Analisa um comprovante (imagem ou PDF) e um texto de contexto.
   * (O restante do arquivo permanece o mesmo)
   */
  async analyzeExpenseWithImage(mediaBuffer, userText, mimeType = 'image/jpeg') {
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
    
    const categories = await Category.findAll({ attributes: ['name'] });
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