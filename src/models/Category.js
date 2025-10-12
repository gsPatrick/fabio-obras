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
      category_flow: {
        type: DataTypes.ENUM('expense', 'revenue'),
        allowNull: false,
        defaultValue: 'expense',
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
          fields: ['name', 'profile_id', 'category_flow']
        }
      ]
    });
  }
  
  static associate(models) {
    this.belongsTo(models.Profile, { foreignKey: 'profile_id', as: 'profile' });
    
    // <<< INÍCIO DA CORREÇÃO >>>
    // A regra padrão ON DELETE SET NULL é boa aqui, mas para MonthlyGoal, é melhor deletar a meta.
    this.hasMany(models.Expense, { foreignKey: 'category_id', as: 'expenses' }); // Mantém o padrão (SET NULL)
    this.hasMany(models.Revenue, { foreignKey: 'category_id', as: 'revenues' }); // Mantém o padrão (SET NULL)
    this.hasMany(models.PendingExpense, { foreignKey: 'suggested_category_id', as: 'pendingExpenses' }); // Mantém o padrão (SET NULL)
    this.hasMany(models.MonthlyGoal, { foreignKey: 'category_id', as: 'monthlyGoals', onDelete: 'CASCADE' }); // Se a categoria some, a meta para ela não faz sentido.
    // <<< FIM DA CORREÇÃO >>>
  }
}

module.exports = Category;