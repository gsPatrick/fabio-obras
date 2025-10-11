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
      revenue_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        comment: 'ID da receita já criada no sistema.',
      },
      suggested_new_category_name: { // Mantido para o fluxo de "criar nova categoria"
        type: DataTypes.STRING,
        allowNull: true,
        comment: 'Nome da nova categoria sugerida pela IA que ainda não existe.'
      },
      suggested_category_flow: { // Mantido
        type: DataTypes.ENUM('expense', 'revenue'),
        allowNull: true,
        comment: 'Indica se a nova categoria sugerida é para despesa ou receita.'
      },
      credit_card_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        comment: 'ID do cartão de crédito selecionado para esta despesa, se houver.',
      },
      installment_count: {
        type: DataTypes.INTEGER,
        allowNull: true,
        comment: 'Número de parcelas para a despesa, se for parcelada.',
      },
      // --- NOVO CAMPO PARA SUBSTIUIR O ENUM 'status' ---
      // Este campo será usado para indicar qual a próxima ação esperada do usuário
      // ou qual etapa do fluxo estamos, sem ser um ENUM no DB.
      action_expected: {
        type: DataTypes.STRING,
        allowNull: true, // Pode ser nulo se não houver ação pendente
        comment: 'Indica a próxima ação esperada do usuário ou etapa do fluxo (ex: "awaiting_new_category_name", "awaiting_card_choice").'
      },
      // --- REMOÇÃO DE CAMPOS TEMPORÁRIOS DE ANÁLISE DA IA ---
      // Esses campos serão passados diretamente ou inferidos quando necessário,
      // em vez de persistir estados intermediários no DB.
      // temp_ai_parsed_value: { type: DataTypes.DECIMAL(10, 2), allowNull: true, },
      // temp_ai_parsed_description: { type: DataTypes.TEXT, allowNull: true, },
      // temp_ai_parsed_category_name: { type: DataTypes.STRING, allowNull: true, },
      // temp_ai_parsed_flow: { type: DataTypes.ENUM('expense', 'revenue'), allowNull: true, },
      // temp_ai_parsed_is_installment: { type: DataTypes.BOOLEAN, allowNull: true, },
      // temp_ai_parsed_installment_count: { type: DataTypes.INTEGER, allowNull: true, },
      // temp_ai_parsed_card_name: { type: DataTypes.STRING, allowNull: true, },
      // temp_card_name: { type: DataTypes.STRING, allowNull: true, },
      // temp_card_closing_day: { type: DataTypes.INTEGER, allowNull: true, },
      // temp_card_due_day: { type: DataTypes.INTEGER, allowNull: true, }
    }, {
      sequelize,
      modelName: 'PendingExpense',
      tableName: 'pending_expenses',
    });
  }

  static associate(models) {
    this.belongsTo(models.Category, { foreignKey: 'suggested_category_id', as: 'suggestedCategory' });
    this.belongsTo(models.Expense, { foreignKey: 'expense_id', as: 'expense' });
    this.belongsTo(models.Revenue, { foreignKey: 'revenue_id', as: 'revenue' });
    this.belongsTo(models.Profile, { foreignKey: 'profile_id', as: 'profile' });
    this.belongsTo(models.CreditCard, { foreignKey: 'credit_card_id', as: 'creditCard' });
  }
}

module.exports = PendingExpense;