// src/models/User.js
const { Model, DataTypes } = require('sequelize');
const bcrypt = require('bcryptjs');

class User extends Model {
  static init(sequelize) {
    super.init({
      email: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true,
        validate: {
          isEmail: true,
        },
      },
      whatsapp_phone: {
        type: DataTypes.STRING,
        allowNull: true, 
      },
      password: {
        type: DataTypes.STRING,
        allowNull: false, // <<< VOLTOU A SER OBRIGATÓRIO
      },
      status: {
        type: DataTypes.ENUM('pending', 'active'),
        defaultValue: 'pending',
        allowNull: false,
      }
    }, {
      sequelize,
      modelName: 'User',
      tableName: 'users',
    });

    this.addHook('beforeSave', async (user) => {
      if (user.changed('password') && user.password) {
        user.password = await bcrypt.hash(user.password, 10);
      }
    });
  }

  checkPassword(password) {
    if (!this.password) return false;
    return bcrypt.compare(password, this.password);
  }
}

module.exports = User;