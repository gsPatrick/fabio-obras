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
      attachment_url: { // Pode ser nulo agora para despesas sem anexo
        type: DataTypes.STRING,
        allowNull: true,
        comment: 'URL da mídia que está aguardando contexto.',
      },
      attachment_mimetype: { // Pode ser nulo
        type: DataTypes.STRING,
        allowNull: true,
        comment: 'O mimeType do anexo (ex: application/pdf).',
      },
      expense_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        comment: 'ID da despesa já criada no sistema (usado para edição).',
      },
      revenue_id: { // NOVO CAMPO: ID da receita criada, se for o caso
        type: DataTypes.INTEGER,
        allowNull: true,
        comment: 'ID da receita já criada no sistema.',
      },
      suggested_new_category_name: {
        type: DataTypes.STRING,
        allowNull: true,
        comment: 'Nome da nova categoria sugerida pela IA que ainda não existe.'
      },
      suggested_category_flow: { // NOVO CAMPO: Fluxo da categoria sugerida (expense/revenue)
        type: DataTypes.ENUM('expense', 'revenue'),
        allowNull: true,
        comment: 'Indica se a nova categoria sugerida é para despesa ou receita.'
      },
      credit_card_id: { // NOVO CAMPO: ID do cartão de crédito selecionado
        type: DataTypes.INTEGER,
        allowNull: true,
        comment: 'ID do cartão de crédito selecionado para esta despesa, se houver.',
      },
      installment_count: { // NOVO CAMPO: Número de parcelas, se for parcelado
        type: DataTypes.INTEGER,
        allowNull: true,
        comment: 'Número de parcelas para a despesa, se for parcelada.',
      },
      status: {
        type: DataTypes.ENUM(
          'awaiting_context',                         // Aguardando descrição para uma mídia
          'awaiting_validation',                      // Despesa/Receita salva, aguardando confirmação/edição
          'awaiting_category_reply',                  // Aguardando escolha de categoria da lista
          'awaiting_new_category_decision',           // Categoria nova sugerida, aguardando decisão (criar/escolher/outros)
          'awaiting_new_category_type',               // Aguardando tipo da nova categoria
          'awaiting_category_flow_decision',          // Aguardando fluxo (despesa/receita) da nova categoria
          'awaiting_new_category_goal',               // Aguardando meta da nova categoria (se for despesa)
          'awaiting_credit_card_choice',              // Aguardando escolha do cartão de crédito
          'awaiting_installment_count',               // Aguardando o número de parcelas
          'awaiting_ai_analysis',                     // Mensagem enviada para IA analisar (temporário)
          'awaiting_context_analysis_complete',       // Análise da IA concluída, pronto para decidir ação
          'awaiting_new_card_name',                   // Fluxo de criação de cartão: aguardando nome
          'awaiting_new_card_closing_day',            // Fluxo de criação de cartão: aguardando dia de fechamento
          'awaiting_new_card_due_day',                // Fluxo de criação de cartão: aguardando dia de vencimento
          'awaiting_card_creation_confirmation'       // Aguardando confirmação da IA para criar cartão
        ),
        defaultValue: 'awaiting_context',
        allowNull: false,
      },
      // Campos temporários para informações da IA
      temp_ai_parsed_value: { // Valor parseado pela IA
        type: DataTypes.DECIMAL(10, 2),
        allowNull: true,
      },
      temp_ai_parsed_description: { // Descrição parseada pela IA
        type: DataTypes.TEXT,
        allowNull: true,
      },
      temp_ai_parsed_category_name: { // Nome da categoria parseado pela IA
        type: DataTypes.STRING,
        allowNull: true,
      },
      temp_ai_parsed_flow: { // Fluxo (expense/revenue) parseado pela IA
        type: DataTypes.ENUM('expense', 'revenue'),
        allowNull: true,
      },
      temp_ai_parsed_is_installment: { // Se a IA sugeriu que é parcelado
        type: DataTypes.BOOLEAN,
        allowNull: true,
      },
      temp_ai_parsed_installment_count: { // Contagem de parcelas sugerida pela IA
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      temp_ai_parsed_card_name: { // Nome do cartão sugerido pela IA
        type: DataTypes.STRING,
        allowNull: true,
      },
      temp_card_name: { // Usado durante o fluxo de criação de cartão
        type: DataTypes.STRING,
        allowNull: true,
      },
      temp_card_closing_day: { // Usado durante o fluxo de criação de cartão
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      temp_card_due_day: { // Usado durante o fluxo de criação de cartão
        type: DataTypes.INTEGER,
        allowNull: true,
      }
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