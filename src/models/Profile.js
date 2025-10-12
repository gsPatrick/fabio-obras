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
    
    // <<< INÍCIO DA CORREÇÃO >>>
    // Adicionar onDelete: 'CASCADE' para todas as associações 'hasMany' e 'hasOne'
    this.hasOne(models.MonitoredGroup, { foreignKey: 'profile_id', as: 'monitoredGroup', onDelete: 'CASCADE' }); 
    this.hasMany(models.Expense, { foreignKey: 'profile_id', as: 'expenses', onDelete: 'CASCADE' });
    this.hasMany(models.PendingExpense, { foreignKey: 'profile_id', as: 'pendingExpenses', onDelete: 'CASCADE' });
    this.hasMany(models.Revenue, { foreignKey: 'profile_id', as: 'revenues', onDelete: 'CASCADE' });
    this.hasMany(models.Category, { foreignKey: 'profile_id', as: 'categories', onDelete: 'CASCADE' }); // Adicionar para categorias
    this.hasMany(models.MonthlyGoal, { foreignKey: 'profile_id', as: 'monthlyGoals', onDelete: 'CASCADE' }); // Adicionar para metas
    this.hasMany(models.CreditCard, { foreignKey: 'profile_id', as: 'creditCards', onDelete: 'CASCADE' }); // Adicionar para cartões
    this.hasMany(models.GuestUser, { foreignKey: 'profile_id', as: 'guestUsers', onDelete: 'CASCADE' }); // Adicionar para convidados
    // <<< FIM DA CORREÇÃO >>>
  }
}

module.exports = Profile;