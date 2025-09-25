require('dotenv').config();
const express = require('express');
const db = require('./models'); // Importa a conexão e os models

class App {
  constructor() {
    this.server = express();
    this.middlewares();
    this.routes();
    this.connectDatabase();
  }

  middlewares() {
    this.server.use(express.json()); // Habilita o uso de JSON no corpo das requisições
  }

  routes() {
    // As rotas principais serão importadas e usadas aqui no futuro
    this.server.get('/', (req, res) => {
        return res.json({ message: 'API Controle de Custos de Obra - Funcionando!' });
    });
  }

  async connectDatabase() {
    try {
      await db.sequelize.authenticate();
      console.log('✅ Conexão com o banco de dados estabelecida com sucesso.');
      // Em desenvolvimento, você pode usar sync para criar as tabelas
      // CUIDADO: { force: true } apaga o banco. Use com cautela.
      await db.sequelize.sync({ alter: true });
      console.log('🔄 Modelos sincronizados com o banco de dados.');
    } catch (error) {
      console.error('❌ Não foi possível conectar ao banco de dados:', error);
    }
  }
}

const app = new App().server;
const port = process.env.API_PORT || 3000;

app.listen(port, () => {
  console.log(`🚀 Servidor rodando na porta ${port}`);
});