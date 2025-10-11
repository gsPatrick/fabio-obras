// src/app.js

const { File } = require('node:buffer');
if (typeof globalThis.File === 'undefined') {
  globalThis.File = File;
}

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const db = require('./models');
const mainRouter = require('./routes');
const { Op } = require('sequelize');

class App {
  constructor() {
    this.server = express();
    this.connectAndSeedDatabase();
    this.middlewares();
    this.routes();
    this.exposeModels();
    this.startPendingExpenseWorker();
    this.startOnboardingWorker();
  }

  middlewares() {
    this.server.use(cors({
      origin: true,
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Profile-Id'],
    }));
    this.server.use(express.json());
    this.server.use(cookieParser());
  }

  routes() {
    this.server.use(mainRouter);
  }

  exposeModels() {
    this.server.locals.models = db;
  }

  async connectAndSeedDatabase() {
    try {
      await db.sequelize.authenticate();
      console.log('✅ Conexão com o banco de dados estabelecida com sucesso.');
      await db.sequelize.sync({ force: false}); // <<< MANTIDO force: false aqui, o que significa que o sync do seeder não apaga tabelas.
                                                // O force: true está na sua configuração de ambiente ou outro lugar.
      console.log('🔄 Modelos sincronizados com o banco de dados.');
      await this.seedAdminUser();
    } catch (error) {
      console.error('❌ Não foi possível conectar, sincronizar ou popular o banco de dados:', error);
      process.exit(1);
    }
  }
  
  async seedAdminUser() {
    const { User, Profile } = db;
    const adminEmail = 'fabio@gmail.com'; 
    const adminPassword = 'Fabio123'; 
    const adminWhatsappPhone = '5521983311000';  
    console.log('[SEEDER] Verificando usuário administrador...');
    
    try {
        let user = await User.findOne({ where: { email: adminEmail } });
        
        if (!user) {
            console.log('[SEEDER] Usuário administrador não encontrado. Criando...');
            user = await User.create({ 
                email: adminEmail, 
                password: adminPassword,
                whatsapp_phone: adminWhatsappPhone,
                status: 'active'
            });
            console.log(`[SEEDER] Usuário administrador '${adminEmail}' criado com sucesso.`);
        } else {
            if (user.status !== 'active' || user.whatsapp_phone !== adminWhatsappPhone) {
                 await user.update({ 
                     status: 'active',
                     whatsapp_phone: adminWhatsappPhone
                 });
                 console.log(`[SEEDER] Status e telefone do administrador '${adminEmail}' foram atualizados.`);
            }
            console.log(`[SEEDER] Usuário administrador '${adminEmail}' já existe e está ativo.`);
        }
        
        let profile = await Profile.findOne({ where: { user_id: user.id } });
        if (!profile) {
            console.log(`[SEEDER] Criando perfil padrão para o usuário ${user.email}...`);
            profile = await Profile.create({ name: 'Perfil Padrão', user_id: user.id });
            await this.seedEssentialCategoriesForNewProfile(profile.id); // <<< MODIFICADO: Chama o novo seeder
            await this.seedAdminSpecificCategories(profile.id); // <<< NOVO: Seeder específico do admin
            console.log('[SEEDER] Perfil Padrão e Categorias iniciais criadas.');
        } else {
            console.log(`[SEEDER] Perfil padrão já existe para o usuário ${user.email}.`);
            await this.seedEssentialCategoriesForNewProfile(profile.id); // <<< MODIFICADO: Garante essenciais
            await this.seedAdminSpecificCategories(profile.id); // <<< NOVO: Garante específicas do admin
        }
    } catch (error) {
        console.error('[SEEDER] ❌ Falha ao verificar ou criar o usuário/perfil administrador:', error);
    }
  }

  // <<< NOVO MÉTODO: Seeder para categorias essenciais (Outros, Receita Padrão) que todo perfil deve ter >>>
  async seedEssentialCategoriesForNewProfile(profileId) {
      if (!profileId) return;
      const { Category } = db;
      const essentialCategories = [
          { name: 'Outros', type: 'Outros', category_flow: 'expense' },
          { name: 'Receita Padrão', type: 'Receita', category_flow: 'revenue' },
      ];
      console.log(`[SEEDER] Verificando e criando categorias essenciais para o perfil ${profileId}...`);
      for (const categoryData of essentialCategories) {
          await Category.findOrCreate({
              where: { name: categoryData.name, profile_id: profileId, category_flow: categoryData.category_flow },
              defaults: { ...categoryData, profile_id: profileId },
          });
      }
      console.log(`[SEEDER] Categorias essenciais para o perfil ${profileId} verificadas.`);
  }
  // <<< FIM NOVO MÉTODO >>>

  // <<< NOVO MÉTODO: Seeder para categorias padrão que SÓ O ADMIN (ou o primeiro perfil) deve ter >>>
  async seedAdminSpecificCategories(profileId) {
    if (!profileId) return;
    const { Category } = db;
    
    // Lista de categorias completa para o admin (ou primeiro perfil)
    const adminCategoriesToSeed = [
        // Mão de Obra
        { name: 'Mão de obra estrutural', type: 'Mão de Obra', category_flow: 'expense' },
        { name: 'Mão de obra cinza', type: 'Mão de Obra', category_flow: 'expense' },
        { name: 'Mão de obra acabamento', type: 'Mão de Obra', category_flow: 'expense' },
        { name: 'Mão de obra gesso', type: 'Mão de Obra', category_flow: 'expense' },
        { name: 'Mão de obra pintura', type: 'Mão de Obra', category_flow: 'expense' },
        { name: 'Mão de obra vidro', type: 'Mão de Obra', category_flow: 'expense' },
        { name: 'Mão de obra esquadrias', type: 'Mão de Obra', category_flow: 'expense' },
        { name: 'Mão de obra hidráulica e elétrica', type: 'Mão de Obra', category_flow: 'expense' },
        // Material
        { name: 'Material ferro', type: 'Material', category_flow: 'expense' },
        { name: 'Material concreto', type: 'Material', category_flow: 'expense' },
        { name: 'Material bruto', type: 'Material', category_flow: 'expense' },
        { name: 'Material piso', type: 'Material', category_flow: 'expense' },
        { name: 'Material argamassa', type: 'Material', category_flow: 'expense' },
        { name: 'Material gesso', type: 'Material', category_flow: 'expense' },
        { name: 'Material esquadria', type: 'Material', category_flow: 'expense' },
        { name: 'Material pintura', type: 'Material', category_flow: 'expense' },
        { name: 'Material fios', type: 'Material', category_flow: 'expense' },
        { name: 'Material iluminação', type: 'Material', category_flow: 'expense' },
        { name: 'Material pedras granitos', type: 'Material', category_flow: 'expense' },
        { name: 'Material louças e metais', type: 'Material', category_flow: 'expense' },
        { name: 'Material equipamentos', type: 'Material', category_flow: 'expense' },
        { name: 'Material ar condicionado', type: 'Material', category_flow: 'expense' },
        { name: 'Material hidráulica', type: 'Material', category_flow: 'expense' },
        // Serviços/Equipamentos
        { name: 'Marcenaria', type: 'Serviços/Equipamentos', category_flow: 'expense' },
        { name: 'Eletros', type: 'Serviços/Equipamentos', category_flow: 'expense' },
    ];

    console.log(`[SEEDER] Verificando e criando categorias específicas do administrador para o perfil ${profileId}...`);
    for (const categoryData of adminCategoriesToSeed) {
        await Category.findOrCreate({
            where: { name: categoryData.name, profile_id: profileId, category_flow: categoryData.category_flow },
            defaults: { ...categoryData, profile_id: profileId },
        });
    }
    console.log('[SEEDER] Categorias específicas do administrador verificadas.');
  }
  // <<< FIM NOVO MÉTODO >>>

  // <<< REMOVIDO: Antigo seedCategories - Agora dividido em dois métodos >>>

  startPendingExpenseWorker() {
    const { PendingExpense, Expense, Category } = db;
    const whatsappService = require('./utils/whatsappService');
    const runWorker = async () => {
      const now = new Date();
      try {
        await PendingExpense.destroy({ where: { status: 'awaiting_validation', expires_at: { [Op.lte]: now } } });
        
        // <<< MODIFICADO: Lidar com expense e revenue na expiração de categoria >>>
        const expiredReplies = await PendingExpense.findAll({ 
            where: { status: 'awaiting_category_reply', expires_at: { [Op.lte]: now } }, 
            include: [
                { model: Category, as: 'suggestedCategory' }, 
                { model: Expense, as: 'expense' },
                { model: Revenue, as: 'revenue' } // Inclui Revenue
            ] 
        });
        for (const pending of expiredReplies) {
          const entryValue = pending.expense ? pending.expense.value : pending.revenue ? pending.revenue.value : 0;
          const entryType = pending.expense ? 'despesa' : 'receita';
          const originalCategoryName = pending.suggestedCategory?.name || 'N/A';

          const formattedValue = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(entryValue);
          const timeoutMessage = `⏰ *Edição Expirada*\n\nO tempo para selecionar uma nova categoria para a ${entryType} de *${formattedValue}* expirou. O item foi mantido com a categoria original: *${originalCategoryName}*.`;
          await whatsappService.sendWhatsappMessage(pending.whatsapp_group_id, timeoutMessage);
          await pending.destroy();
        }
        // <<< FIM MODIFICADO >>>
        
        // <<< MODIFICADO: Adicionado novos status para limpar >>>
        await PendingExpense.destroy({ where: { status: { [Op.in]: ['awaiting_context', 'awaiting_ai_analysis', 'awaiting_context_analysis_complete', 'awaiting_new_category_decision', 'awaiting_new_category_type', 'awaiting_category_flow_decision', 'awaiting_new_category_goal', 'awaiting_credit_card_choice', 'awaiting_installment_count', 'awaiting_new_card_name', 'awaiting_new_card_closing_day', 'awaiting_new_card_due_day', 'awaiting_card_creation_confirmation'] }, expires_at: { [Op.lte]: now } } });
        // <<< FIM MODIFICADO >>>

      } catch (error) {
        console.error('[WORKER] ❌ Erro ao processar despesas pendentes:', error);
      }
    };
    setInterval(runWorker, 30000); 
  }

  startOnboardingWorker() {
    const { OnboardingState } = db;
    const runWorker = async () => {
        try {
            await OnboardingState.destroy({ where: { expires_at: { [Op.lte]: new Date() } } });
        } catch (error) {
            console.error('[WORKER-ONBOARDING] ❌ Erro ao limpar estados de onboarding:', error);
        }
    };
    setInterval(runWorker, 5 * 60 * 1000);
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