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
   * Converte TODAS as páginas de um buffer de PDF em um array de buffers de imagem JPEG.
   * <<< ESTA FUNÇÃO FOI COMPLETAMENTE REESCRITA >>>
   */
  async _convertPdfToImage(pdfBuffer) {
    logger.info('[AIService] PDF detectado. Iniciando conversão de TODAS as páginas...');
    const poppler = new Poppler();
    const tempPdfPath = path.join(os.tmpdir(), `doc-${Date.now()}.pdf`);
    const tempOutputPath = path.join(os.tmpdir(), `img-${Date.now()}`);
    const generatedImagePaths = [];

    try {
      // 1. Salva o buffer do PDF em um arquivo temporário
      fs.writeFileSync(tempPdfPath, pdfBuffer);

      // 2. Obtém as informações do PDF, incluindo o número de páginas
      const fileInfo = await poppler.pdfInfo(tempPdfPath);
      const totalPages = fileInfo.pages;
      if (!totalPages || totalPages === 0) {
        logger.error('[AIService] PDF parece estar vazio ou corrompido. Nenhuma página encontrada.');
        return [];
      }
      logger.info(`[AIService] O PDF tem ${totalPages} página(s). Convertendo todas...`);

      // 3. Opções para converter TODAS as páginas
      const options = {
        firstPageToConvert: 1,
        lastPageToConvert: totalPages,
        jpegFile: true,
      };

      // 4. Executa a conversão. Isso irá criar arquivos como 'img-123-1.jpg', 'img-123-2.jpg', etc.
      await poppler.pdfToCairo(tempPdfPath, tempOutputPath, options);
      
      // 5. Lê todos os arquivos de imagem gerados e os transforma em buffers
      const imageBuffers = [];
      for (let i = 1; i <= totalPages; i++) {
        const imagePath = `${tempOutputPath}-${i}.jpg`;
        if (fs.existsSync(imagePath)) {
          imageBuffers.push(fs.readFileSync(imagePath));
          generatedImagePaths.push(imagePath); // Guarda o caminho para deletar depois
        }
      }
      
      logger.info(`[AIService] ${imageBuffers.length} página(s) convertida(s) para imagem com sucesso.`);
      return imageBuffers;
      
    } catch (error) {
      logger.error('[AIService] Erro crítico durante a conversão do PDF com node-poppler.', error);
      return []; // Retorna um array vazio em caso de falha
    } finally {
      // 6. Garante que TODOS os arquivos temporários sejam deletados
      if (fs.existsSync(tempPdfPath)) fs.unlinkSync(tempPdfPath);
      for (const path of generatedImagePaths) {
        if (fs.existsSync(path)) fs.unlinkSync(path);
      }
    }
  }

  /**
   * Analisa um comprovante (imagem ou PDF de múltiplas páginas) e um texto de contexto.
   * <<< ESTA FUNÇÃO FOI ATUALIZADA PARA LIDAR COM MÚLTIPLAS IMAGENS >>>
   */
  async analyzeExpenseWithImage(mediaBuffer, userText, mimeType = 'image/jpeg') {
    logger.info(`[AIService] Iniciando análise detalhada de mídia (${mimeType}).`);
    
    let imageContent = [];
    let prompt;

    const categories = await Category.findAll({ attributes: ['name'] });
    const categoryList = `"${categories.map(c => c.name).join('", "')}"`;

    if (mimeType.includes('pdf')) {
      // Converte todas as páginas do PDF para um array de imagens
      const convertedImages = await this._convertPdfToImage(mediaBuffer);
      if (!convertedImages || convertedImages.length === 0) {
        logger.error('[AIService] Falha na conversão de PDF, cancelando análise.');
        return null;
      }
      // Mapeia cada buffer de imagem para o formato que a API da OpenAI espera
      imageContent = convertedImages.map(buffer => ({
        type: 'image_url',
        image_url: { url: `data:image/jpeg;base64,${buffer.toString('base64')}` },
      }));
      // Cria um prompt específico para múltiplas páginas
      prompt = `
        Sua tarefa é analisar as SEGUINTES IMAGENS, que compõem um único documento de várias páginas.
        Analise todas as páginas para extrair as informações consolidadas e retorne APENAS um objeto JSON válido com as chaves:
        "value" (Número, o valor total ou principal), "documentType" (String), "payer" (String), "receiver" (String), "baseDescription" (String, um resumo curto e objetivo da transação, como "Pagamento PIX para [Nome do Recebedor]"), "categoryName" (String).
        A "categoryName" DEVE ser uma das seguintes opções: [${categoryList}].
        Contexto do usuário (use para definir a categoria E para enriquecer a descrição, se relevante): "${userText || 'Nenhum'}"
      `;
    } else {
      // Lógica para uma única imagem (JPG, PNG, etc.)
      const base64Image = mediaBuffer.toString('base64');
      imageContent.push({
        type: 'image_url',
        image_url: { url: `data:image/jpeg;base64,${base64Image}` },
      });
      // Cria um prompt específico para uma única página
       prompt = `
        Sua tarefa é analisar a IMAGEM de um documento financeiro e um texto complementar fornecido pelo usuário.
        Extraia as informações e retorne APENAS um objeto JSON válido com as chaves:
        "value" (Número), "documentType" (String), "payer" (String), "receiver" (String), "baseDescription" (String, um resumo curto e objetivo da transação, como "Pagamento PIX para [Nome do Recebedor]"), "categoryName" (String).
        A "categoryName" DEVE ser uma das seguintes opções: [${categoryList}].
        Contexto do usuário (use para definir a categoria E para enriquecer a descrição, se relevante): "${userText || 'Nenhum'}"
      `;
    }
    
    try {
      const response = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [{
          role: 'user',
          // O conteúdo agora é um array com o texto do prompt + todas as imagens
          content: [
            { type: 'text', text: prompt },
            ...imageContent
          ],
        }],
        response_format: { type: "json_object" },
      });

      const result = JSON.parse(response.choices[0].message.content);
      logger.info(`[AIService] Análise detalhada concluída. Páginas analisadas: ${imageContent.length}.`, result);
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