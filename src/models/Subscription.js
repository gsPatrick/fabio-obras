// src/models/Subscription.js

const { Model, DataTypes } = require('sequelize');

class Subscription extends Model {
  static init(sequelize) {
    super.init({
      status: {
        type: DataTypes.ENUM('active', 'trial', 'pending', 'cancelled', 'expired'),
        defaultValue: 'pending',
        allowNull: false,
      },
      expires_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
          profile_limit: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 1, // Por padrão, todo novo plano começa com limite de 1 perfil
    },
      preapproval_id: {
        type: DataTypes.STRING,
        allowNull: true, // ID da pré-aprovação do Mercado Pago
        unique: true,
      },
    }, {
      sequelize,
      modelName: 'Subscription',
      tableName: 'subscriptions',
    });
  }

  static associate(models) {
    // Liga a assinatura ao User (Usuário)
    this.belongsTo(models.User, { foreignKey: 'user_id', as: 'user' });
  }
}

module.exports = Subscription;