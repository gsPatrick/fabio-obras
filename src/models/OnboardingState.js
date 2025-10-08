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
      status: {
        type: DataTypes.ENUM(
          'awaiting_pending_payment',       // Usuário pendente interagindo, aguardando clique no botão
          'awaiting_email',                 // Novo usuário, aguardando e-mail para pré-cadastro
          'awaiting_password',              // Novo usuário, aguardando definição de senha
          'awaiting_profile_choice',        // Usuário ativo, aguardando decisão sobre o perfil
          'awaiting_new_profile_name',      // Usuário ativo, aguardando nome do novo perfil
          'awaiting_category_creation_start', // Usuário ativo, aguardando decisão para começar a criar categorias
          'awaiting_new_category_name',     // Usuário ativo, aguardando nome da nova categoria
          'awaiting_new_category_type'      // Usuário ativo, aguardando tipo da nova categoria
        ),
        allowNull: false,
        comment: 'Em qual etapa da conversa o onboarding está.'
      },
      temp_user_email: {
          type: DataTypes.STRING,
          allowNull: true,
          comment: 'Armazena temporariamente o e-mail do novo usuário.'
      },
      profile_id: {
          type: DataTypes.INTEGER,
          allowNull: true,
          comment: 'Armazena o ID do perfil que está sendo configurado.'
      },
      temp_category_name: {
          type: DataTypes.STRING,
          allowNull: true,
          comment: 'Armazena temporariamente o nome da categoria que está sendo criada.'
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