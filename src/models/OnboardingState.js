// src/models/OnboardingState.js

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
          'awaiting_email',
          'awaiting_password',              // <<< NOVO ESTADO
          'awaiting_profile_choice',
          'awaiting_new_profile_name',
          'awaiting_category_creation_start',
          'awaiting_new_category_name',
          'awaiting_new_category_type',
          'awaiting_pending_payment' // <<< Adicionado para consistência
        ),
        allowNull: false,
      },
      temp_user_email: {
          type: DataTypes.STRING,
          allowNull: true,
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