// Carrega as variáveis de ambiente do arquivo .env
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const db = require('./models');
const mainRouter = require('./routes');

class App {
  constructor() {
    this.server = express();
    this.connectAndSeedDatabase();
    this.middlewares();
    this.routes();
  }

  middlewares() {
    this.server.use(cors());
    this.server.use(express.json());
  }

  routes() {
    this.server.use(mainRouter);
  }

  async connectAndSeedDatabase() {
    try {
      await db.sequelize.authenticate();
      console.log('✅ Conexão com o banco de dados estabelecida com sucesso.');
      await db.sequelize.sync({ force: true });
      console.log('🔄 Modelos sincronizados com o banco de dados.');
      await this.seedCategories();
    } catch (error) {
      console.error('❌ Não foi possível conectar ou sincronizar com o banco de dados:', error);
      process.exit(1); 
    }
  }

  async seedCategories() {
    const { Category } = db;
    const categoriesToSeed = [
        { name: 'Mão de obra estrutural', type: 'Mão de Obra' },
        { name: 'Mão de obra cinza', type: 'Mão de Obra' },
        { name: 'Mão de obra acabamento', type: 'Mão de Obra' },
        { name: 'Mão de obra gesso', type: 'Mão de Obra' },
        { name: 'Mão de obra pintura', type: 'Mão de Obra' },
        { name: 'Mão de obra vidro', type: 'Mão de Obra' },
        { name: 'Mão de obra esquadrias', type: 'Mão de Obra' },
        { name: 'Mão de obra hidráulica e elétrica', type: 'Mão de Obra' },
        { name: 'Material ferro', type: 'Material' },
        { name: 'Material concreto', type: 'Material' },
        { name: 'Material bruto', type: 'Material' },
        { name: 'Material piso', type: 'Material' },
        { name: 'Material argamassa', type: 'Material' },
        { name: 'Material gesso', type: 'Material' },
        { name: 'Material esquadria', type: 'Material' },
        { name: 'Material pintura', type: 'Material' },
        { name: 'Material fios', type: 'Material' },
        { name: 'Material iluminação', type: 'Material' },
        { name: 'Material pedras granitos', type: 'Material' },
        { name: 'Material louças e metais', type: 'Material' },
        { name: 'Material equipamentos', type: 'Material' },
        { name: 'Material ar condicionado', type: 'Material' },
        { name: 'Material hidráulica', type: 'Material' },
        { name: 'Marcenaria', type: 'Serviços/Equipamentos' },
        { name: 'Eletros', type: 'Serviços/Equipamentos' },
        { name: 'Outros', type: 'Outros' },
    ];
    
    console.log('[SEEDER] Verificando e criando categorias essenciais...');
    for (const categoryData of categoriesToSeed) {
        const [category, created] = await Category.findOrCreate({
            where: { name: categoryData.name },
            defaults: categoryData,
        });
        if (created) {
            console.log(`[SEEDER] Categoria '${category.name}' criada.`);
        }
    }
    console.log('[SEEDER] Verificação de categorias concluída.');
  }
}

const instance = new App();
const app = instance.server;

// ===================================================================
// <<< WORKER DE CONFIRMAÇÃO AUTOMÁTICA E TIMEOUTS >>>
// ===================================================================
const { PendingExpense, Expense, Category } = require('./models');
const { Op } = require('sequelize');
const whatsappService = require('./utils/whatsappService');

async function runPendingExpenseWorker() {
  console.log('[WORKER] ⚙️ Verificando despesas pendentes expiradas...');
  const now = new Date();

  try {
    // 1. CONFIRMAÇÃO AUTOMÁTICA (após 3 minutos de validação)
    const expiredValidations = await PendingExpense.findAll({
      where: {
        status: 'awaiting_validation',
        expires_at: { [Op.lte]: now }
      },
      include: [{ model: Category, as: 'suggestedCategory' }]
    });

    for (const pending of expiredValidations) {
      console.log(`[WORKER] ✅ Confirmando automaticamente a despesa ID: ${pending.id}`);
      await Expense.create({
        value: pending.value,
        description: pending.description,
        expense_date: pending.createdAt,
        whatsapp_message_id: pending.whatsapp_message_id,
        category_id: pending.suggested_category_id,
      });
      const successMessage = `✅ *Custo Confirmado Automaticamente*\n\n` +
                             `A despesa de *${new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(pending.value)}* ` +
                             `foi registrada na categoria *${pending.suggestedCategory.name}*.`;
      await whatsappService.sendWhatsappMessage(pending.whatsapp_group_id, successMessage);
      await pending.destroy();
    }

    // 2. TIMEOUT DE EDIÇÃO (após 3 minutos esperando resposta numérica)
    const expiredReplies = await PendingExpense.findAll({
      where: {
        status: 'awaiting_category_reply',
        expires_at: { [Op.lte]: now }
      },
      include: [{ model: Category, as: 'suggestedCategory' }]
    });

    for (const pending of expiredReplies) {
      console.log(`[WORKER] ⏰ Finalizando edição não respondida da despesa ID: ${pending.id}`);
      await Expense.create({
        value: pending.value,
        description: pending.description,
        expense_date: pending.createdAt,
        whatsapp_message_id: pending.whatsapp_message_id,
        category_id: pending.suggested_category_id,
      });
      const timeoutMessage = `⏰ *Edição Expirada*\n\n` +
                             `O tempo para selecionar uma nova categoria expirou. A despesa foi confirmada com a categoria original: *${pending.suggestedCategory.name}*.`;
      await whatsappService.sendWhatsappMessage(pending.whatsapp_group_id, timeoutMessage);
      await pending.destroy();
    }

    // 3. LIMPEZA DE CONTEXTOS (após 2 minutos esperando descrição)
    await PendingExpense.destroy({
      where: {
        status: 'awaiting_context',
        expires_at: { [Op.lte]: now }
      }
    });

  } catch (error) {
    console.error('[WORKER] ❌ Erro ao processar despesas pendentes:', error);
  }
}

setInterval(runPendingExpenseWorker, 30000);
// ===================================================================

const port = process.env.API_PORT || 5000;

app.listen(port, () => {
  console.log(`🚀 Servidor rodando na porta ${port}`);
  const publicUrl = process.env.PUBLIC_URL || `http://localhost:${port}`;
  console.log(`🔗 Endpoint do Webhook configurável: ${publicUrl}/webhook/z-api`);
});