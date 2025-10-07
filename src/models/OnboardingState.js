// src/models/OnboardingState.js

const { Model, DataTypes } = require('sequelize');

class OnboardingState extends Model {
  static init(sequelize) {
    super.init({
      group_id: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true,
        comment: 'ID do grupo em processo de onboarding.'
      },
      initiator_phone: {
        type: DataTypes.STRING,
        allowNull: false,
        comment: 'Número de quem adicionou o bot e iniciou o processo.'
      },
      // <<< MUDANÇA AQUI >>>
      status: {
        type: DataTypes.ENUM(
          'awaiting_profile_choice',        // Início, esperando decisão sobre o perfil
          'awaiting_new_profile_name',      // Esperando nome do novo perfil
          'awaiting_category_creation_start', // Esperando decisão para começar a criar categorias
          'awaiting_new_category_name',     // Esperando nome da nova categoria
          'awaiting_new_category_type'      // Esperando tipo da nova categoria
        ),
        allowNull: false,
        comment: 'Em qual etapa da conversa o onboarding está.'
      },
      // Armazena o ID do perfil que está sendo configurado
      profile_id: {
          type: DataTypes.INTEGER,
          allowNull: true,
      },
      // Armazena temporariamente o nome da categoria que está sendo criada
      temp_category_name: {
          type: DataTypes.STRING,
          allowNull: true,
      },
      expires_at: {
        type: DataTypes.DATE,
        allowNull: false,
        comment: 'Data de expiração para limpar estados abandonados.'
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