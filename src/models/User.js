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
        allowNull: false,
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

  // <<< INÍCIO DA CORREÇÃO >>>
  static associate(models) {
    // 1:1 - Um Usuário tem uma Assinatura
    this.hasOne(models.Subscription, { foreignKey: 'user_id', as: 'subscription' });
    // 1:N - Um Usuário tem muitos Perfis
    this.hasMany(models.Profile, { foreignKey: 'user_id', as: 'profiles' });
  }
  // <<< FIM DA CORREÇÃO >>>
}

module.exports = User;