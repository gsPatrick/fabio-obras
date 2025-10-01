// src/models/MonitoredGroup.js
const { Model, DataTypes } = require('sequelize');

class MonitoredGroup extends Model {
  static init(sequelize) {
    super.init({
      group_id: {
        type: DataTypes.STRING,
        allowNull: false,
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
      // MUDANÇA: O índice de unicidade será no par (group_id, profile_id)
      indexes: [
        {
          unique: true,
          fields: ['group_id', 'profile_id'] // Adicionando profile_id
        }
      ]
    });
  }
  
  static associate(models) {
    // MUDANÇA: Associação 1:1 com Profile (o Profile tem 1 grupo monitorado)
    // O Profile vai ser o 'dono' do MonitoredGroup.
    this.belongsTo(models.Profile, { foreignKey: 'profile_id', as: 'profile' }); 
  }
}

module.exports = MonitoredGroup;