// src/models/OnboardingState.js

const { Model, DataTypes } = require('sequelize');

class OnboardingState extends Model {
  static init(sequelize) {
    super.init({
      group_id: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true,
      },
      initiator_phone: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      status: {
        type: DataTypes.ENUM(
          'awaiting_email',                 // <<< NOVO: Esperando o email para pré-cadastro
          'awaiting_profile_choice',
          'awaiting_new_profile_name',
          'awaiting_category_creation_start',
          'awaiting_new_category_name',
          'awaiting_new_category_type'
        ),
        allowNull: false,
      },
      profile_id: {
          type: DataTypes.INTEGER,
          allowNull: true,
      },
      temp_category_name: {
          type: DataTypes.STRING,
          allowNull: true,
      },
      expires_at: {
        type: DataTypes.DATE,
        allowNull: false,
      }
    }, {
      sequelize,
      modelName: 'OnboardingState',
      tableName: 'onboarding_states',
    });
  }

  static associate(models) {
    this.belongsTo(models.User, { foreignKey: 'user_id', as: 'user' });
    this.belongsTo(models.Profile, { foreignKey: 'profile_id', as: 'profile' });
  }
}

module.exports = OnboardingState;