// src/models/PendingExpense.js

const { Model, DataTypes } = require('sequelize');

class PendingExpense extends Model {
  static init(sequelize) {
    super.init({
      value: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: true,
      },
      description: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      whatsapp_message_id: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true,
      },
      whatsapp_group_id: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      participant_phone: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      expires_at: {
        type: DataTypes.DATE,
        allowNull: false,
      },
      attachment_url: {
        type: DataTypes.STRING,
        allowNull: true,
        comment: 'URL da mídia que está aguardando contexto.',
      },
      attachment_mimetype: {
        type: DataTypes.STRING,
        allowNull: true,
        comment: 'O mimeType do anexo (ex: application/pdf).',
      },
      expense_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        comment: 'ID da despesa já criada no sistema (usado para edição).',
      },
      // <<< MUDANÇA AQUI >>>
      suggested_new_category_name: {
        type: DataTypes.STRING,
        allowNull: true,
        comment: 'Nome da nova categoria sugerida pela IA que ainda não existe.'
      },
      status: {
        // <<< MUDANÇA AQUI >>>
        type: DataTypes.ENUM(
          'awaiting_context', 
          'awaiting_validation', 
          'awaiting_category_reply',
          'awaiting_new_category_decision', // Novo: Aguardando decisão sobre a nova categoria
          'awaiting_new_category_type'      // Novo: Aguardando o tipo da nova categoria
        ),
        defaultValue: 'awaiting_context',
        allowNull: false,
      },
    }, {
      sequelize,
      modelName: 'PendingExpense',
      tableName: 'pending_expenses',
    });
  }

  static associate(models) {
    this.belongsTo(models.Category, { foreignKey: 'suggested_category_id', as: 'suggestedCategory' });
    this.belongsTo(models.Expense, { foreignKey: 'expense_id', as: 'expense' });
    this.belongsTo(models.Profile, { foreignKey: 'profile_id', as: 'profile' });
  }
}

module.exports = PendingExpense;