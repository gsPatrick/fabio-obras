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
      }
    }, {
      sequelize,
      modelName: 'Revenue',
      tableName: 'revenues',
    });
  }
  
  static associate(models) { // <<< ADICIONADO static associate
      this.belongsTo(models.Profile, { foreignKey: 'profile_id', as: 'profile' }); // <<< NOVO: Associação ao Perfil
  }
}

module.exports = Revenue;