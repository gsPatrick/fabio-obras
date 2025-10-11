// src/models/Category.js

const { Model, DataTypes } = require('sequelize');

class Category extends Model {
  static init(sequelize) {
    super.init({
      name: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      type: {
        type: DataTypes.STRING, 
        allowNull: false,
        comment: 'Um tipo descritivo para agrupar categorias (ex: Mão de Obra, Material Bruto, Alimentação)',
      },
      category_flow: { // NOVO CAMPO
        type: DataTypes.ENUM('expense', 'revenue'),
        allowNull: false,
        defaultValue: 'expense', // Padrão será 'expense'
        comment: 'Indica se a categoria é para despesas ou receitas.',
      },
      profile_id: {
          type: DataTypes.INTEGER,
          allowNull: false,
      }
    }, {
      sequelize,
      modelName: 'Category',
      tableName: 'categories',
      indexes: [
        {
          unique: true,
          fields: ['name', 'profile_id', 'category_flow'] // Unicidade agora inclui category_flow
        }
      ]
    });
  }
  
  static associate(models) {
    this.belongsTo(models.Profile, { foreignKey: 'profile_id', as: 'profile' });
    this.hasMany(models.Expense, { foreignKey: 'category_id', as: 'expenses' });
    this.hasMany(models.Revenue, { foreignKey: 'category_id', as: 'revenues' }); // NOVA ASSOCIAÇÃO
    this.hasMany(models.PendingExpense, { foreignKey: 'suggested_category_id', as: 'pendingExpenses' });
  }
}

module.exports = Category;