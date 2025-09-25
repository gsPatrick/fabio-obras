require('dotenv').config();

module.exports = {
  dialect: process.env.DB_DIALECT || 'postgres',
  host: process.env.DB_HOST,
  username: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  define: {
    timestamps: true,       // Cria colunas createdAt e updatedAt
    underscored: true,      // Nomes de tabelas e colunas em snake_case (ex: user_id)
    underscoredAll: true,
  },
};