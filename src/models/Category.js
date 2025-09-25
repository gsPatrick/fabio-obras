const { Model, DataTypes } = require('sequelize');

class Category extends Model {
  static init(sequelize) {
    super.init({
      name: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true,
      },
      // Ajustamos o ENUM para melhor agrupar suas categorias específicas
      type: {
        type: DataTypes.ENUM('Mão de Obra', 'Material', 'Serviços/Equipamentos', 'Outros'),
        allowNull: false,
      }
    }, {
      sequelize,
      modelName: 'Category',
      tableName: 'categories',
    });
  }
}

module.exports = Category;