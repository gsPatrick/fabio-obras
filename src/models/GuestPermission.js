// src/models/GuestPermission.js

const { Model, DataTypes } = require('sequelize');

class GuestPermission extends Model {
  static init(sequelize) {
    super.init({
      // -----------------------------------------------------------
      // Permissões por Módulo (Granularidade Solicitada)
      // -----------------------------------------------------------
      can_access_dashboard: { // Corresponde à rota /dashboard
        type: DataTypes.BOOLEAN,
        defaultValue: false,
      },
      can_access_categories: { // Corresponde à rota /categories
        type: DataTypes.BOOLEAN,
        defaultValue: false,
      },
      can_access_reports: { // Corresponde à rota /reports
        type: DataTypes.BOOLEAN,
        defaultValue: false,
      },
      can_access_expenses: { // Corresponde à rota /expenses (Visão Detalhada)
        type: DataTypes.BOOLEAN,
        defaultValue: false,
      },
      // NOTA: can_add_expense via WhatsApp é uma permissão separada 
      // e é deixada aqui caso precise ser controlada pelo dono, mas 
      // não aparecerá no checklist visual simplificado.
      can_add_expense: {
         type: DataTypes.BOOLEAN,
         defaultValue: true, // Padrão: pode adicionar despesas (via WhatsApp)
         comment: 'Permissão para adicionar despesas via WhatsApp.'
      },
      can_edit_or_delete_expense: {
         type: DataTypes.BOOLEAN,
         defaultValue: false,
         comment: 'Permissão para editar/deletar despesas (manualmente ou via correção no WhatsApp).'
      }
    }, {
      sequelize,
      modelName: 'GuestPermission',
      tableName: 'guest_permissions',
    });
  }

  static associate(models) {
    this.belongsTo(models.GuestUser, { foreignKey: 'guest_user_id', as: 'guestUser' });
  }
}

module.exports = GuestPermission;