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
              whatsapp_phone: { // <<< NOVO CAMPO
        type: DataTypes.STRING,
        allowNull: true, // Permitir nulo inicialmente
        comment: 'Número de WhatsApp do usuário no formato DDI+DDD+Numero (ex: 5511987654321)'
      }
      },
      password: {
        type: DataTypes.STRING,
        allowNull: false,
      },
    }, {
      sequelize,
      modelName: 'User',
      tableName: 'users',
    });

    // Hook para criptografar a senha antes de salvar/criar
    this.addHook('beforeSave', async (user) => {
      if (user.changed('password')) {
        user.password = await bcrypt.hash(user.password, 10);
      }
    });
  }

  // Método para verificar a senha durante o login
  checkPassword(password) {
    return bcrypt.compare(password, this.password);
  }
}

module.exports = User;