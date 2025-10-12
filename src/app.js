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
// <<< MUDANÇA: Importar a classe, não a instância >>>
const WebhookService = require('./features/WhatsappWebhook/whatsappWebhook.service'); 

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
      await db.sequelize.sync({ force: true});
      console.log('🔄 Modelos sincronizados com o banco de dados.');
      await this.seedAdminUser();
    } catch (error) {
      console.error('❌ Não foi possível conectar, sincronizar ou popular o banco de dados:', error);
      process.exit(1);
    }
  }
  
  // <<< INÍCIO DA MUDANÇA: Seeder agora associa o grupo de teste >>>
  async seedAdminUser() {
    const { User, Profile, MonitoredGroup } = db;
    const adminEmail = 'fabio@gmail.com'; 
    const adminPassword = 'Fabio123'; 
    const adminWhatsappPhone = '5571983141335';
    const testGroupId = process.env.ZAPI_GROUP_ID || '120363422133729566@g.us'; // Pega do .env ou usa um padrão
    const testGroupName = 'Grupo de Teste Admin';

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
            await this.seedEssentialCategoriesForNewProfile(profile.id);
            await this.seedAdminSpecificCategories(profile.id);
            console.log('[SEEDER] Perfil Padrão e Categorias iniciais criadas.');
        } else {
            console.log(`[SEEDER] Perfil padrão já existe para o usuário ${user.email}.`);
            await this.seedEssentialCategoriesForNewProfile(profile.id);
            await this.seedAdminSpecificCategories(profile.id);
        }

        // Nova lógica para garantir que o grupo de teste está monitorado
        if (testGroupId) {
            console.log(`[SEEDER] Verificando monitoramento do grupo de teste: ${testGroupId}`);
            const [monitoredGroup, created] = await MonitoredGroup.findOrCreate({
                where: { group_id: testGroupId, profile_id: profile.id },
                defaults: {
                    name: testGroupName,
                    is_active: true,
                    profile_id: profile.id
                }
            });

            if (created) {
                console.log(`[SEEDER] Grupo '${testGroupName}' adicionado ao monitoramento.`);
            } else {
                if (!monitoredGroup.is_active) {
                    await monitoredGroup.update({ is_active: true, name: testGroupName });
                    console.log(`[SEEDER] Monitoramento do grupo '${testGroupName}' foi reativado.`);
                } else {
                    console.log(`[SEEDER] Grupo '${testGroupName}' já está sendo monitorado ativamente.`);
                }
            }
        }
        // <<< FIM DA MUDANÇA >>>
    } catch (error) {
        console.error('[SEEDER] ❌ Falha ao verificar ou criar o usuário/perfil/grupo administrador:', error);
    }
  }

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

  async seedAdminSpecificCategories(profileId) {
    if (!profileId) return;
    const { Category } = db;
    
    const adminCategoriesToSeed = [
        { name: 'Mão de obra estrutural', type: 'Mão de Obra', category_flow: 'expense' },
        { name: 'Mão de obra cinza', type: 'Mão de Obra', category_flow: 'expense' },
        { name: 'Mão de obra acabamento', type: 'Mão de Obra', category_flow: 'expense' },
        { name: 'Mão de obra gesso', type: 'Mão de Obra', category_flow: 'expense' },
        { name: 'Mão de obra pintura', type: 'Mão de Obra', category_flow: 'expense' },
        { name: 'Mão de obra vidro', type: 'Mão de Obra', category_flow: 'expense' },
        { name: 'Mão de obra esquadrias', type: 'Mão de Obra', category_flow: 'expense' },
        { name: 'Mão de obra hidráulica e elétrica', type: 'Mão de Obra', category_flow: 'expense' },
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

  // <<< MUDANÇA: Chamar o método estático da classe >>>
  startPendingExpenseWorker() {
    setInterval(() => WebhookService.runPendingExpenseWorker(), 30000); 
  }
  // <<< FIM DA MUDANÇA >>>

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