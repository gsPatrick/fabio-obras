// src/models/MonitoredGroup.js
const { Model, DataTypes } = require('sequelize');

class MonitoredGroup extends Model {
  static init(sequelize) {
    super.init({
      group_id: {
        type: DataTypes.STRING,
        allowNull: false,
        // <<< MUDANÇA: A linha 'unique: true' foi movida para o objeto de opções abaixo >>>
        comment: 'ID do grupo no formato da Z-API (ex: 120363...@g.us)'
      },
      name: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      is_active: {
        type: DataTypes.BOOLEAN,
        defaultValue: true,
      }
    }, {
      sequelize,
      modelName: 'MonitoredGroup',
      tableName: 'monitored_groups',
      // <<< MUDANÇA: Adicionamos um índice para garantir a unicidade >>>
      // Isso gera um SQL mais compatível com o PostgreSQL durante o 'sync'
      indexes: [
        {
          unique: true,
          fields: ['group_id']
        }
      ]
    });
  }
}

module.exports = MonitoredGroup;