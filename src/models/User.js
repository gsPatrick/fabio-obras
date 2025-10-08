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
        comment: 'Número de WhatsApp do usuário no formato DDI+DDD+Numero (ex: 5511983311000)'
      },
      password: {
        type: DataTypes.STRING,
        allowNull: true, // <<< PERMITE NULO PARA CADASTRO PENDENTE
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
      // Só criptografa se a senha foi modificada E não é nula
      if (user.changed('password') && user.password) {
        user.password = await bcrypt.hash(user.password, 10);
      }
    });
  }

  checkPassword(password) {
    // Se não há senha no banco, a comparação falha
    if (!this.password) return false;
    return bcrypt.compare(password, this.password);
  }
}

module.exports = User;