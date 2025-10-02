// src/models/Category.js

const { Model, DataTypes } = require('sequelize');

class Category extends Model {
  static init(sequelize) {
    super.init({
      name: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true, // A unicidade será no par (name, profile_id)
      },
      // Ajustamos o ENUM para melhor agrupar suas categorias específicas
      type: {
        type: DataTypes.STRING, // <<< MUDANÇA AQUI
        allowNull: false,
      },
            // Adicionar a chave estrangeira profile_id (mantida da última correção)
      profile_id: {
          type: DataTypes.INTEGER,
          allowNull: false, // Uma categoria deve sempre pertencer a um perfil
      }
    }, {
      sequelize,
      modelName: 'Category',
      tableName: 'categories',
      // CRÍTICO: Removendo a unicidade global de 'name' e adicionando um índice composto (name, profile_id)
      indexes: [
        {
          unique: true,
          fields: ['name', 'profile_id']
        }
      ]
    });
  }
  
  static associate(models) {
    // N:1 - Categoria pertence a um Perfil
    this.belongsTo(models.Profile, { foreignKey: 'profile_id', as: 'profile' }); // <<< NOVO
    // 1:N - Uma Categoria tem muitas Despesas
    this.hasMany(models.Expense, { foreignKey: 'category_id', as: 'expenses' });
    this.hasMany(models.PendingExpense, { foreignKey: 'suggested_category_id', as: 'pendingExpenses' });
  }
}

module.exports = Category;