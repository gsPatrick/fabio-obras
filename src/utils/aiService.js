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

  async transcribeAudio(audioBuffer) {
    if (!audioBuffer) return null;
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
   * Analisa um comprovante (imagem) e um texto de contexto para extrair dados detalhados.
   * @param {Buffer} imageBuffer - O buffer da imagem.
   * @param {string | null} userText - O texto de contexto do usuário.
   * @returns {Promise<object|null>} Um objeto com a análise detalhada.
   */
  async analyzeExpenseWithImage(imageBuffer, userText) {
    logger.info('[AIService] Iniciando análise detalhada de despesa com imagem e contexto.');
    const categories = await Category.findAll({ attributes: ['name'] });
    const categoryList = categories.map(c => c.name).join('", "');
    const base64Image = imageBuffer.toString('base64');

    // <<< PROMPT APRIMORADO PARA EXTRAÇÃO DETALHADA >>>
    const prompt = `
      Sua tarefa é analisar a imagem de um documento financeiro e um texto complementar fornecido pelo usuário.
      Extraia as seguintes informações e retorne APENAS um objeto JSON válido com as seguintes chaves:

      1.  "value": (Número) O valor monetário total da transação. Ex: 150.75. Se não encontrar, retorne 0.
      2.  "documentType": (String) O tipo de documento. Ex: "Comprovante PIX", "Nota Fiscal", "Recibo".
      3.  "payer": (String) O nome da pessoa ou empresa que pagou. Se não encontrar, retorne "Não identificado".
      4.  "receiver": (String) O nome da pessoa ou empresa que recebeu o pagamento. Se não encontrar, retorne "Não identificado".
      5.  "baseDescription": (String) Uma descrição curta e objetiva do que a IA extraiu da imagem. Ex: "Pagamento para Loja de Ferramentas ABC".
      6.  "categoryName": (String) A categoria MAIS APROPRIADA para esta despesa, baseando-se TANTO na imagem quanto no texto do usuário. Escolha UMA das seguintes opções: ["${categoryList}"].

      Texto complementar do usuário (use como contexto principal para a categoria): "${userText || 'Nenhum'}"

      Exemplo de resposta JSON:
      {
        "value": 150.75,
        "documentType": "Comprovante PIX",
        "payer": "João da Silva",
        "receiver": "Marcenaria Mãos de Ouro",
        "baseDescription": "Transferência via PIX",
        "categoryName": "Marcenaria"
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
      });

      const result = JSON.parse(response.choices[0].message.content);
      logger.info('[AIService] Análise detalhada concluída.', result);
      return this._validateAnalysisResult(result, categoryList);
    } catch (error) {
      logger.error('[AIService] Erro na análise detalhada:', error);
      return null;
    }
  }

  // Função para análise apenas de texto (não precisa de alteração)
  async analyzeExpenseFromText(expenseText) {
    // ... (esta função pode permanecer a mesma, pois já retorna um JSON simples)
    return null; // Por ora, vamos focar no fluxo principal com imagem
  }

  _validateAnalysisResult(result, categoryList) {
    if (!result.categoryName || !categoryList.includes(result.categoryName)) {
      logger.warn(`[AIService] IA sugeriu categoria inválida/vazia ('${result.categoryName}'). Usando 'Outros'.`);
      result.categoryName = 'Outros';
    }
    return result;
  }
}

module.exports = new AIService();