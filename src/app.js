// src/app.js

// ===================================================================
// <<< CORREÇÃO DEFINITIVA PARA O ERRO 'File is not defined' >>>
// Definimos a classe 'File' globalmente no início da aplicação.
// Isso garante que a biblioteca da OpenAI a encontre sempre.
// ===================================================================
const { File } = require('node:buffer');
if (typeof globalThis.File === 'undefined') {
  globalThis.File = File;
}

// Carrega as variáveis de ambiente do arquivo .env
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const db = require('./models');
const mainRouter = require('./routes');

// Movido para o topo para ser acessível dentro da classe
const { Op } = require('sequelize');

class App {
  constructor() {
    this.server = express();
    this.connectAndSeedDatabase();
    this.middlewares();
    this.routes();
    this.startPendingExpenseWorker();
  }

  middlewares() {
    this.server.use(cors({
      origin: true,
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
    }));

    this.server.use(express.json());
    this.server.use(cookieParser());
  }

  routes() {
    this.server.use(mainRouter);
  }

  async connectAndSeedDatabase() {
    try {
      await db.sequelize.authenticate();
      console.log('✅ Conexão com o banco de dados estabelecida com sucesso.');
      await db.sequelize.sync({ force: true }); // Mantenha 'force: true' apenas em desenvolvimento
      console.log('🔄 Modelos sincronizados com o banco de dados.');
      await this.seedAdminUser();
      await this.seedCategories();
    } catch (error) {
      console.error('❌ Não foi possível conectar, sincronizar ou popular o banco de dados:', error);
      process.exit(1);
    }
  }
  
  async seedAdminUser() {
    const { User } = db;
    const adminEmail = 'admin@admin.com';
    console.log('[SEEDER] Verificando usuário administrador...');
    try {
        const adminExists = await User.findOne({ where: { email: adminEmail } });
        if (!adminExists) {
            console.log('[SEEDER] Usuário administrador não encontrado. Criando...');
            await User.create({ email: adminEmail, password: 'admin' });
            console.log(`[SEEDER] Usuário administrador '${adminEmail}' criado com sucesso.`);
        } else {
            console.log(`[SEEDER] Usuário administrador '${adminEmail}' já existe.`);
        }
    } catch (error) {
        console.error('[SEEDER] ❌ Falha ao verificar ou criar o usuário administrador:', error);
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
        await Category.findOrCreate({
            where: { name: categoryData.name },
            defaults: categoryData,
        });
    }
    console.log('[SEEDER] Verificação de categorias concluída.');
  }

  startPendingExpenseWorker() {
    const { PendingExpense, Expense, Category } = db;
    const whatsappService = require('./utils/whatsappService');

    const EXPENSE_EDIT_WAIT_TIME_MINUTES = 1; 
    const CONTEXT_WAIT_TIME_MINUTES = 2; 

    const runWorker = async () => {
      console.log('[WORKER] ⚙️ Verificando despesas pendentes expiradas...');
      const now = new Date();
      try {
        // 1. TIMEOUT DE VALIDAÇÃO (despesa salva, mas o prazo para edição de categoria expirou)
        const expiredValidations = await PendingExpense.findAll({
          where: { 
            status: 'awaiting_validation', 
            expires_at: { [Op.lte]: now } 
          },
          include: [{ model: Category, as: 'suggestedCategory' }, { model: Expense, as: 'expense' }]
        });

        for (const pending of expiredValidations) {
          console.log(`[WORKER] ✅ Confirmando automaticamente a despesa ID: ${pending.expense_id} (pendência ${pending.id})`);
          
          // MUDANÇA: A mensagem de confirmação final foi removida.
          // A despesa já está salva, apenas limpamos a pendência.
          await pending.destroy(); 
        }

        // 2. TIMEOUT DE EDIÇÃO (usuário não respondeu à solicitação de nova categoria)
        const expiredReplies = await PendingExpense.findAll({
          where: { 
            status: 'awaiting_category_reply', 
            expires_at: { [Op.lte]: now } 
          },
          include: [{ model: Category, as: 'suggestedCategory' }, { model: Expense, as: 'expense' }]
        });

        for (const pending of expiredReplies) {
          console.log(`[WORKER] ⏰ Finalizando edição não respondida da despesa ID: ${pending.expense_id} (pendência ${pending.id})`);

          const formattedValue = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(pending.expense.value);
          const timeoutMessage = `⏰ *Edição Expirada*\n\nO tempo para selecionar uma nova categoria expirou. A despesa *já salva* de *${formattedValue}* foi mantida com a categoria original: *${pending.suggestedCategory.name}*.`;
          await whatsappService.sendWhatsappMessage(pending.whatsapp_group_id, timeoutMessage);
          await pending.destroy();
        }

        // 3. LIMPEZA DE CONTEXTOS (após N minutos esperando descrição)
        await PendingExpense.destroy({
          where: { status: 'awaiting_context', expires_at: { [Op.lte]: now } }
        });

      } catch (error) {
        console.error('[WORKER] ❌ Erro ao processar despesas pendentes:', error);
      }
    };
    
    setInterval(runWorker, 30000); 
  }
}

const instance = new App();
const app = instance.server;

const port = process.env.API_PORT || 5000;

app.listen(port, () => {
  console.log(`🚀 Servidor rodando na porta ${port}`);
  const publicUrl = process.env.PUBLIC_URL || `http://localhost:${port}`;
  console.log(`🔗 Endpoint do Webhook configurável: ${publicUrl}/webhook/z-api`);
});