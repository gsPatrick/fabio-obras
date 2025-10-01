// src/models/Expense.js

const { Model, DataTypes } = require('sequelize');

class Expense extends Model {
  static init(sequelize) {
    super.init({
      value: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
      },
      description: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      expense_date: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
      whatsapp_message_id: {
        type: DataTypes.STRING,
        allowNull: true, // Pode ser nulo se lançado manualmente
      }
    }, {
      sequelize,
      modelName: 'Expense',
      tableName: 'expenses',
    });
  }

  static associate(models) {
    this.belongsTo(models.Category, { foreignKey: 'category_id', as: 'category' });
    this.hasMany(models.Attachment, { foreignKey: 'expense_id', as: 'attachments' });
    this.belongsTo(models.Profile, { foreignKey: 'profile_id', as: 'profile' }); // <<< NOVO: Associação ao Perfil
  }
}

module.exports = Expense;