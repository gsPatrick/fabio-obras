// Carrega as variáveis de ambiente do arquivo .env
require('dotenv').config();

const express = require('express');
const cors = require('cors'); // Importa o CORS
const db = require('./models'); // Importa a conexão do Sequelize e todos os models
const mainRouter = require('./routes'); // Importa nosso centralizador de rotas

class App {
  constructor() {
    this.server = express();
    
    // Conectar ao banco ANTES de iniciar o servidor
    this.connectDatabase();
    
    this.middlewares();
    this.routes();
  }

  middlewares() {
    // Habilita o CORS para todas as rotas e origens
    this.server.use(cors());

    // Habilita o servidor a interpretar corpos de requisição no formato JSON.
    this.server.use(express.json());
  }

  routes() {
    // Utiliza o router principal que contém todas as rotas da aplicação.
    this.server.use(mainRouter);
  }

  async connectDatabase() {
    try {
      await db.sequelize.authenticate();
      console.log('✅ Conexão com o banco de dados estabelecida com sucesso.');
      
      // Sincroniza os models com o banco de dados.
      await db.sequelize.sync({ force: true });
      console.log('🔄 Modelos sincronizados com o banco de dados.');
    } catch (error) {
      console.error('❌ Não foi possível conectar ou sincronizar com o banco de dados:', error);
      process.exit(1); 
    }
  }
}

// Cria a instância da aplicação
const app = new App().server;

// Define a porta a partir das variáveis de ambiente ou usa 5000 como padrão
const port = process.env.API_PORT || 5000;

// Inicia o servidor
app.listen(port, () => {
  console.log(`🚀 Servidor rodando na porta ${port}`);
  const publicUrl = process.env.PUBLIC_URL || `http://localhost:${port}`;
  console.log(`🔗 Endpoint do Webhook configurável: ${publicUrl}/webhook/z-api`);
});
