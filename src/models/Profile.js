// src/models/Profile.js

const { Model, DataTypes } = require('sequelize');

class Profile extends Model {
  static init(sequelize) {
    super.init({
      name: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      image_url: {
        type: DataTypes.STRING,
        allowNull: true, // URL da imagem do perfil/avatar
        defaultValue: null,
      },
      // user_id será definido automaticamente pela associação
    }, {
      sequelize,
      modelName: 'Profile',
      tableName: 'profiles',
    });
  }

  static associate(models) {
    // 1:N - Um Usuário tem muitos Perfis
    this.belongsTo(models.User, { foreignKey: 'user_id', as: 'user' });
    // 1:1 - Um Perfil tem 1 Grupo Monitorado (opcional)
    this.hasOne(models.MonitoredGroup, { foreignKey: 'profile_id', as: 'monitoredGroup' }); 
    // 1:N - Os Expenses e PendingExpenses pertencerão ao Profile
    this.hasMany(models.Expense, { foreignKey: 'profile_id', as: 'expenses' });
    this.hasMany(models.PendingExpense, { foreignKey: 'profile_id', as: 'pendingExpenses' });
    this.hasMany(models.Revenue, { foreignKey: 'profile_id', as: 'revenues' });
  }
}

module.exports = Profile;