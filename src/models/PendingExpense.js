const { Model, DataTypes } = require('sequelize');

class PendingExpense extends Model {
  static init(sequelize) {
    super.init({
      value: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
        comment: 'Valor extraído pela IA.',
      },
      description: {
        type: DataTypes.TEXT,
        allowNull: true,
        comment: 'Descrição extraída pela IA ou texto/áudio do usuário.',
      },
      whatsapp_message_id: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true,
        comment: 'ID da mensagem original do WhatsApp que iniciou o fluxo.',
      },
      whatsapp_group_id: {
        type: DataTypes.STRING,
        allowNull: false,
        comment: 'ID do grupo onde a mensagem foi enviada.',
      },
      participant_phone: {
        type: DataTypes.STRING,
        allowNull: true,
        comment: 'Número de quem enviou a despesa.',
      },
      attachment_url: {
        type: DataTypes.STRING,
        allowNull: true,
        comment: 'URL do anexo (imagem/documento) para processamento posterior.',
      },
      attachment_mimetype: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      expires_at: {
        type: DataTypes.DATE,
        allowNull: false,
        comment: 'Timestamp de quando a pendência expira (5 minutos após a criação).',
      },
    }, {
      sequelize,
      modelName: 'PendingExpense',
      tableName: 'pending_expenses',
    });
  }

  static associate(models) {
    // A despesa pendente tem uma categoria SUGERIDA pela IA
    this.belongsTo(models.Category, { foreignKey: 'suggested_category_id', as: 'suggestedCategory' });
  }
}

module.exports = PendingExpense;