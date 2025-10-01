// src/models/MonthlyGoal.js

const { Model, DataTypes } = require('sequelize');

class MonthlyGoal extends Model {
  static init(sequelize) {
    super.init({
      value: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
      },
      // Um campo para indicar se é uma Meta Total ou por Categoria
      is_total_goal: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
        allowNull: false,
        comment: 'True se for a meta de custo total mensal para o perfil. False se for por categoria.'
      },
      // Não armazenamos o mês/ano, pois a meta é aplicada ao mês corrente (simplificação).
      // Se a meta mudar em um mês, a nova meta se aplica.
    }, {
      sequelize,
      modelName: 'MonthlyGoal',
      tableName: 'monthly_goals',
      // Garante que o perfil só tenha UMA meta total. E UMA meta por categoria.
      indexes: [
        {
          unique: true,
          fields: ['profile_id', 'is_total_goal', 'category_id'],
          where: {
            // Aplica a unicidade da meta total apenas se category_id for nulo
            category_id: null
          }
        },
        {
          unique: true,
          fields: ['profile_id', 'category_id'],
          where: {
            // Aplica a unicidade da meta por categoria apenas se category_id for não nulo
            category_id: { [require('sequelize').Op.ne]: null }
          }
        }
      ]
    });
  }

  static associate(models) {
    // 1:N - Um Perfil tem muitas Metas
    this.belongsTo(models.Profile, { foreignKey: 'profile_id', as: 'profile' });
    // 1:1 - Uma Meta por Categoria (opcional, só para metas de categoria)
    this.belongsTo(models.Category, { foreignKey: 'category_id', as: 'category', allowNull: true });
  }
}

module.exports = MonthlyGoal;