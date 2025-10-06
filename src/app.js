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
    this.exposeModels(); // Expõe modelos para o controller de Perfil
    this.startPendingExpenseWorker();
  }

  middlewares() {
    this.server.use(cors({
      origin: true,
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Profile-Id'], // Adiciona o novo header
    }));

    this.server.use(express.json());
    this.server.use(cookieParser());
  }

  routes() {
    this.server.use(mainRouter);
  }

  // Expõe modelos no contexto do Express
  exposeModels() {
    this.server.locals.models = db;
  }

  async connectAndSeedDatabase() {
    try {
      await db.sequelize.authenticate();
      console.log('✅ Conexão com o banco de dados estabelecida com sucesso.');
      await db.sequelize.sync({ force: true}); 
      console.log('🔄 Modelos sincronizados com o banco de dados.');
      await this.seedAdminUser(); // Agora também cria categorias/perfil
    } catch (error) {
      console.error('❌ Não foi possível conectar, sincronizar ou popular o banco de dados:', error);
      process.exit(1);
    }
  }
  
  async seedAdminUser() {
    const { User, Profile } = db; // Inclui Profile
    const adminEmail = 'fabio@gmail.com'; 
    const adminPassword = 'Fabio123'; 
    const adminWhatsappPhone = '552183311000'; 5521983311000
    console.log('[SEEDER] Verificando usuário administrador...');
    
    try {
        let user = await User.findOne({ where: { email: adminEmail } });
        
        if (!user) {
            console.log('[SEEDER] Usuário administrador não encontrado. Criando...');
            user = await User.create({ 
                email: adminEmail, 
                password: adminPassword,
                whatsapp_phone: adminWhatsappPhone
            });
            console.log(`[SEEDER] Usuário administrador '${adminEmail}' criado com sucesso.`);
        } else {
            if (user.whatsapp_phone !== adminWhatsappPhone) {
                 await user.update({ whatsapp_phone: adminWhatsappPhone });
                 console.log(`[SEEDER] Número do administrador '${adminEmail}' atualizado.`);
            }
            console.log(`[SEEDER] Usuário administrador '${adminEmail}' já existe.`);
        }
        
        let profile = await Profile.findOne({ where: { user_id: user.id } });
        if (!profile) {
            console.log(`[SEEDER] Criando perfil padrão para o usuário ${user.email}...`);
            profile = await Profile.create({ name: 'Perfil Padrão', user_id: user.id });
            
            // <<< CORREÇÃO 1: Passar o ID do perfil recém-criado para o seeder de categorias.
            await this.seedCategories(profile.id); 
            
            console.log('[SEEDER] Perfil Padrão e Categorias iniciais criadas.');
        } else {
            console.log(`[SEEDER] Perfil padrão já existe para o usuário ${user.email}.`);
            // <<< MELHORIA: Garantir que as categorias existam mesmo se o perfil já existir
            await this.seedCategories(profile.id);
        }
        
    } catch (error) {
        console.error('[SEEDER] ❌ Falha ao verificar ou criar o usuário/perfil administrador:', error);
    }
  }

  // <<< CORREÇÃO 2: A função agora recebe e usa o 'profileId'.
  async seedCategories(profileId) {
    if (!profileId) {
        console.error('[SEEDER] Erro: profileId não foi fornecido para o seeder de categorias.');
        return;
    }

    const { Category } = db;
    const categoriesToSeed = [
        // ... (sua lista de categorias permanece a mesma)
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
        // <<< CORREÇÃO 3: Usar o 'profileId' para buscar e para criar a categoria.
        await Category.findOrCreate({
            where: { name: categoryData.name, profile_id: profileId },
            defaults: { ...categoryData, profile_id: profileId },
        });
    }
    console.log('[SEEDER] Verificação de categorias concluída.');
  }

  startPendingExpenseWorker() {
    // ... (o restante do seu arquivo permanece o mesmo)
    const { PendingExpense, Expense, Category } = db;
    const whatsappService = require('./utils/whatsappService');

    const EXPENSE_EDIT_WAIT_TIME_MINUTES = 1; 
    const CONTEXT_WAIT_TIME_MINUTES = 2; 

    const runWorker = async () => {
      console.log('[WORKER] ⚙️ Verificando despesas pendentes expiradas...');
      const now = new Date();
      try {
        const expiredValidations = await PendingExpense.findAll({
          where: { 
            status: 'awaiting_validation', 
            expires_at: { [Op.lte]: now } 
          },
          include: [{ model: Category, as: 'suggestedCategory' }, { model: Expense, as: 'expense' }]
        });

        for (const pending of expiredValidations) {
          console.log(`[WORKER] ✅ Confirmando automaticamente a despesa ID: ${pending.expense_id} (pendência ${pending.id})`);
          await pending.destroy(); 
        }

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