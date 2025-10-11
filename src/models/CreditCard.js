// src/models/CreditCard.js

const { Model, DataTypes } = require('sequelize');

class CreditCard extends Model {
  static init(sequelize) {
    super.init({
      name: {
        type: DataTypes.STRING,
        allowNull: false,
        comment: 'Nome do cartão (ex: Nubank, Cartão da Obra XYZ)',
      },
      last_four_digits: { // Últimos 4 dígitos para identificação segura
        type: DataTypes.STRING(4),
        allowNull: true,
        comment: 'Últimos quatro dígitos do cartão para identificação. Opcional.',
      },
      closing_day: { // Melhor dia de compra (dia de fechamento da fatura)
        type: DataTypes.INTEGER,
        allowNull: false,
        validate: {
          min: 1,
          max: 31,
        },
        comment: 'Dia do mês em que a fatura do cartão fecha. Despesas lançadas após este dia (e antes do vencimento) entrarão na fatura do próximo mês.',
      },
      due_day: { // Dia de vencimento da fatura
        type: DataTypes.INTEGER,
        allowNull: false,
        validate: {
          min: 1,
          max: 31,
        },
        comment: 'Dia do mês em que a fatura do cartão vence.',
      },
      is_active: {
        type: DataTypes.BOOLEAN,
        defaultValue: true,
        allowNull: false,
      }
    }, {
      sequelize,
      modelName: 'CreditCard',
      tableName: 'credit_cards',
      indexes: [
        {
          unique: true,
          fields: ['name', 'profile_id'] // Um perfil não pode ter dois cartões com o mesmo nome
        }
      ]
    });
  }

  static associate(models) {
    this.belongsTo(models.Profile, { foreignKey: 'profile_id', as: 'profile' });
    this.hasMany(models.Expense, { foreignKey: 'credit_card_id', as: 'expenses' });
  }
}

module.exports = CreditCard;