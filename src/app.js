// src/app.js

// Carrega as variáveis de ambiente do arquivo .env
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
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
    // IMPORTANTE: Ajuste a 'origin' para a URL do seu front-end em produção
    this.server.use(cors({
        origin: process.env.FRONTEND_URL || 'http://localhost:3000', 
        credentials: true
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

      // Sincroniza todos os modelos de forma segura
      await db.sequelize.sync({ force: true });
      console.log('🔄 Modelos sincronizados com o banco de dados.');
      
      // Chama os "seeders" após a sincronização
      await this.seedAdminUser();
      await this.seedCategories();
      
    } catch (error) {
      console.error('❌ Não foi possível conectar, sincronizar ou popular o banco de dados:', error);
      process.exit(1); 
    }
  }
  
  /**
   * Verifica se o usuário administrador padrão existe e o cria se necessário.
   * Utiliza a lógica findOne + create, conforme solicitado.
   */
  async seedAdminUser() {
    const { User } = db;
    const adminEmail = 'admin@admin.com';

    console.log('[SEEDER] Verificando usuário administrador...');
    try {
        const adminExists = await User.findOne({
            where: { email: adminEmail }
        });

        if (!adminExists) {
            console.log('[SEEDER] Usuário administrador não encontrado. Criando...');
            await User.create({
                email: adminEmail,
                password: 'admin' // O hook no modelo irá criptografar a senha
            });
            console.log(`[SEEDER] Usuário administrador '${adminEmail}' criado com sucesso.`);
        } else {
            console.log(`[SEEDER] Usuário administrador '${adminEmail}' já existe.`);
        }
    } catch (error) {
        console.error('[SEEDER] ❌ Falha ao verificar ou criar o usuário administrador:', error);
    }
  }

  /**
   * Verifica e cria as categorias essenciais da aplicação.
   */
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
        // Usando findOrCreate aqui por ser a melhor prática para múltiplos itens
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
setInterval(runPendingExpenseWorker, 30000);
// ===================================================================

const port = process.env.API_PORT || 5000;

app.listen(port, () => {
  console.log(`🚀 Servidor rodando na porta ${port}`);
  const publicUrl = process.env.PUBLIC_URL || `http://localhost:${port}`;
  console.log(`🔗 Endpoint do Webhook configurável: ${publicUrl}/webhook/z-api`);
});