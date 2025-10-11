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
        allowNull: true,
      },
      // NOVOS CAMPOS PARA CARTÃO DE CRÉDITO E PARCELAMENTO
      is_installment: { // Indica se é uma despesa parcelada
        type: DataTypes.BOOLEAN,
        defaultValue: false,
        allowNull: false,
      },
      total_installments: { // Número total de parcelas
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      current_installment_number: { // Número da parcela atual (ex: 1 de 3)
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      original_expense_id: { // Referência à despesa "mãe" para parcelamentos
        type: DataTypes.INTEGER,
        allowNull: true,
        comment: 'ID da despesa original se esta for uma parcela subsequente.',
      },
      installment_total_value: { // Valor total da compra parcelada
        type: DataTypes.DECIMAL(10, 2),
        allowNull: true,
        comment: 'Valor total da compra parcelada, presente em todas as parcelas.',
      },
      charge_date: { // Data em que a parcela será lançada na fatura (dia do vencimento da fatura, etc)
        type: DataTypes.DATEONLY,
        allowNull: true,
        comment: 'Data efetiva que a despesa ou parcela deve ser considerada na fatura do cartão.',
      },
      is_paid: { // Para despesas de cartão, indica se já foi paga na fatura
        type: DataTypes.BOOLEAN,
        defaultValue: false,
        allowNull: false,
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
    this.belongsTo(models.Profile, { foreignKey: 'profile_id', as: 'profile' });
    this.belongsTo(models.CreditCard, { foreignKey: 'credit_card_id', as: 'creditCard' });
    this.hasMany(models.Expense, { foreignKey: 'original_expense_id', as: 'installments' });
    this.belongsTo(models.Expense, { foreignKey: 'original_expense_id', as: 'originalExpense' });
  }
}

module.exports = Expense;