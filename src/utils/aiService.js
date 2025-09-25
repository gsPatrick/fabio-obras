require('dotenv').config();
const OpenAI = require('openai');
const logger = require('./logger');
const { Category } = require('../models');
const fs = require('fs');
const path = require('path');
const os = require('os');

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

class AIService {

  /**
   * Transcreve um buffer de áudio para texto usando o Whisper.
   * @param {Buffer} audioBuffer - O buffer do arquivo de áudio.
   * @returns {Promise<string|null>} O texto transcrito.
   */
  async transcribeAudio(audioBuffer) {
    if (!audioBuffer) return null;
    logger.info('[AIService] Iniciando transcrição de áudio com Whisper...');

    try {
      // A API do Whisper espera um File-like object, então salvamos o buffer temporariamente.
      const tempFilePath = path.join(os.tmpdir(), `audio-${Date.now()}.ogg`);
      fs.writeFileSync(tempFilePath, audioBuffer);

      const transcription = await openai.audio.transcriptions.create({
        file: fs.createReadStream(tempFilePath),
        model: 'whisper-1',
      });

      // Remove o arquivo temporário após a transcrição.
      fs.unlinkSync(tempFilePath);

      logger.info(`[AIService] Áudio transcrito com sucesso: "${transcription.text}"`);
      return transcription.text;
    } catch (error) {
      logger.error('[AIService] Erro ao transcrever áudio com Whisper:', error);
      return null;
    }
  }

  /**
   * Analisa um comprovante (imagem) e um texto associado.
   * @param {Buffer} imageBuffer - O buffer da imagem do comprovante.
   * @param {string | null} userText - O texto opcional enviado pelo usuário.
   * @returns {Promise<object|null>} Objeto com { value, categoryName, description }.
   */
  async analyzeExpenseWithImage(imageBuffer, userText) {
    logger.info('[AIService] Iniciando análise de despesa COM IMAGEM.');
    const categories = await Category.findAll({ attributes: ['name'] });
    const categoryList = categories.map(c => c.name).join(', ');
    const base64Image = imageBuffer.toString('base64');

    const prompt = `
      Analise a imagem de um comprovante e o texto do usuário.
      Sua tarefa é extrair três informações e retornar APENAS um objeto JSON válido:
      1. "value": O valor total da despesa como um número (ex: 150.75).
      2. "description": Uma breve descrição do que foi pago.
      3. "categoryName": A categoria MAIS APROPRIADA, escolhendo UMA das seguintes: [${categoryList}].

      Texto do usuário: "${userText || 'Nenhum'}"
      Retorne apenas o JSON.
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
      logger.info('[AIService] Análise de imagem concluída.', result);
      return this._validateAnalysisResult(result, categoryList);
    } catch (error) {
      logger.error('[AIService] Erro na análise com imagem:', error);
      return null;
    }
  }
  
  /**
   * Analisa uma despesa descrita APENAS por texto (transcrito de um áudio).
   * @param {string} expenseText - O texto descrevendo a despesa.
   * @returns {Promise<object|null>} Objeto com { value, categoryName, description }.
   */
  async analyzeExpenseFromText(expenseText) {
    logger.info('[AIService] Iniciando análise de despesa APENAS COM TEXTO.');
    const categories = await Category.findAll({ attributes: ['name'] });
    const categoryList = categories.map(c => c.name).join(', ');

    const prompt = `
      Analise o texto a seguir, que descreve uma despesa.
      Sua tarefa é extrair três informações e retornar APENAS um objeto JSON válido:
      1. "value": O valor da despesa como um número (ex: 50.00).
      2. "description": Uma breve descrição da despesa baseada no texto.
      3. "categoryName": A categoria MAIS APROPRIADA, escolhendo UMA das seguintes: [${categoryList}].

      Texto para análise: "${expenseText}"
      Retorne apenas o JSON. Exemplo: {"value": 50.00, "description": "Pagamento do gesseiro", "categoryName": "Mão de obra gesso"}
    `;

    try {
      const response = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: "json_object" },
      });

      const result = JSON.parse(response.choices[0].message.content);
      logger.info('[AIService] Análise de texto concluída.', result);
      return this._validateAnalysisResult(result, categoryList);
    } catch (error) {
      logger.error('[AIService] Erro na análise com texto:', error);
      return null;
    }
  }

  /**
   * Valida o resultado da análise da IA, garantindo que a categoria é válida.
   * @private
   */
  _validateAnalysisResult(result, categoryList) {
    if (!categoryList.includes(result.categoryName)) {
      logger.warn(`[AIService] IA sugeriu categoria inválida ('${result.categoryName}'). Usando 'Outros'.`);
      result.categoryName = 'Outros';
    }
    return result;
  }
}

module.exports = new AIService();