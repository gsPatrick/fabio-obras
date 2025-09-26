// src/models/PendingExpense.js

const { Model, DataTypes } = require('sequelize');

class PendingExpense extends Model {
  static init(sequelize) {
    super.init({
      value: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: true, // Será nulo até a análise final
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
      // ===================================================================
      // <<< ADICIONE ESTE CAMPO >>>
      // ===================================================================
      attachment_mimetype: {
        type: DataTypes.STRING,
        allowNull: true, // Pode ser nulo para pendências antigas ou sem anexo
        comment: 'O mimeType do anexo (ex: application/pdf).',
      },
      // ===================================================================
      status: {
        type: DataTypes.ENUM('awaiting_context', 'awaiting_validation', 'awaiting_category_reply'),
        defaultValue: 'awaiting_context', // O novo estado inicial
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
  }
}

module.exports = PendingExpense;