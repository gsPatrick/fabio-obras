// src/models/Revenue.js

const { Model, DataTypes } = require('sequelize');

class Revenue extends Model {
  static init(sequelize) {
    super.init({
      value: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
      },
      description: {
        type: DataTypes.TEXT,
        allowNull: false,
      },
      revenue_date: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
      whatsapp_message_id: {
        type: DataTypes.STRING,
        allowNull: true,
      }
    }, {
      sequelize,
      modelName: 'Revenue',
      tableName: 'revenues',
    });
  }
  
  static associate(models) {
      this.belongsTo(models.Profile, { foreignKey: 'profile_id', as: 'profile' });
      this.belongsTo(models.Category, { foreignKey: 'category_id', as: 'category' }); 
  }
}

module.exports = Revenue;