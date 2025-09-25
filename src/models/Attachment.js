const { Model, DataTypes } = require('sequelize');

class Attachment extends Model {
  static init(sequelize) {
    super.init({
      url: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      mimetype: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      filename: {
        type: DataTypes.STRING,
        allowNull: true,
      }
    }, {
      sequelize,
      modelName: 'Attachment',
      tableName: 'attachments',
    });
  }

  static associate(models) {
    this.belongsTo(models.Expense, { foreignKey: 'expense_id', as: 'expense' });
  }
}

module.exports = Attachment;