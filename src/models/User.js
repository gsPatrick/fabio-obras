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
        comment: 'Número de WhatsApp do usuário no formato DDI+DDD+Numero (ex: 5511987654321)'
      },
      password: {
        type: DataTypes.STRING,
        allowNull: true, // <<< MUDANÇA: Senha pode ser nula inicialmente
      },
      // <<< NOVO CAMPO >>>
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
      if (user.changed('password') && user.password) { // <<< MUDANÇA: Verifica se a senha existe
        user.password = await bcrypt.hash(user.password, 10);
      }
    });
  }

  checkPassword(password) {
    if (!this.password) return false; // <<< MUDANÇA: Se não há senha, não compara
    return bcrypt.compare(password, this.password);
  }
}

module.exports = User;