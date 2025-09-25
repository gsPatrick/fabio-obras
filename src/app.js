// Carrega as variáveis de ambiente do arquivo .env
require('dotenv').config();

const express = require('express');
const cors = require('cors'); // Importa o CORS
const db = require('./models'); // Importa a conexão do Sequelize e todos os models
const mainRouter = require('./routes'); // Importa nosso centralizador de rotas

class App {
  constructor() {
    this.server = express();
    
    // Conectar ao banco e popular dados essenciais ANTES de iniciar o servidor
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

      // <<< INÍCIO DA LÓGICA DE SEEDER DAS CATEGORIAS >>>
      await this.seedCategories();
      // <<< FIM DA LÓGICA DE SEEDER DAS CATEGORIAS >>>

    } catch (error) {
      console.error('❌ Não foi possível conectar ou sincronizar com o banco de dados:', error);
      process.exit(1); 
    }
  }

  /**
   * Garante que todas as categorias essenciais existam no banco de dados.
   * Utiliza o método 'findOrCreate' para não criar duplicatas.
   */
  async seedCategories() {
    const { Category } = db;
    const categoriesToSeed = [
        // Mão de Obra
        { name: 'Mão de obra estrutural', type: 'Mão de Obra' },
        { name: 'Mão de obra cinza', type: 'Mão de Obra' },
        { name: 'Mão de obra acabamento', type: 'Mão de Obra' },
        { name: 'Mão de obra gesso', type: 'Mão de Obra' },
        { name: 'Mão de obra pintura', type: 'Mão de Obra' },
        { name: 'Mão de obra vidro', type: 'Mão de Obra' },
        { name: 'Mão de obra esquadrias', type: 'Mão de Obra' },
        { name: 'Mão de obra hidráulica e elétrica', type: 'Mão de Obra' },
        // Material
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
        // Serviços/Equipamentos
        { name: 'Marcenaria', type: 'Serviços/Equipamentos' },
        { name: 'Eletros', type: 'Serviços/Equipamentos' },
        // Outros
        { name: 'Outros', type: 'Outros' },
    ];
    
    console.log('[SEEDER] Verificando e criando categorias essenciais...');
    for (const categoryData of categoriesToSeed) {
        // findOrCreate retorna [instância, created(boolean)]
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

// Cria a instância da aplicação
const app = new App().server;

const port = process.env.API_PORT || 5000;

app.listen(port, () => {
  console.log(`🚀 Servidor rodando na porta ${port}`);
  const publicUrl = process.env.PUBLIC_URL || `http://localhost:${port}`;
  console.log(`🔗 Endpoint do Webhook configurável: ${publicUrl}/webhook/z-api`);
});