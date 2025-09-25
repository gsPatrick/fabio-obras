const { Model, DataTypes } = require('sequelize');

class MonitoredGroup extends Model {
  static init(sequelize) {
    super.init({
      group_id: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true,
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
    });
  }
}

module.exports = MonitoredGroup;