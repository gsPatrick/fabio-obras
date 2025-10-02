// src/models/GuestUser.js

const { Model, DataTypes } = require('sequelize');

class GuestUser extends Model {
  static init(sequelize) {
    super.init({
      email: {
        type: DataTypes.STRING,
        allowNull: false,
        comment: 'Email do usuário convidado (para eventual login).'
      },
      status: {
        type: DataTypes.ENUM('pending', 'active', 'revoked'),
        defaultValue: 'pending',
        allowNull: false,
        comment: 'Status do convite: ativo, pendente de aceite, ou revogado.'
      },
      // Chave de convite (para a URL de aceitação)
      invitation_token: {
        type: DataTypes.STRING,
        allowNull: true,
        unique: true,
      },
      // O ID do usuário real, se ele já aceitou o convite e existe no sistema
      invited_user_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
      }
    }, {
      sequelize,
      modelName: 'GuestUser',
      tableName: 'guest_users',
    });
  }

  static associate(models) {
    // N:1 - Um Convidado pertence a um Perfil
    this.belongsTo(models.Profile, { foreignKey: 'profile_id', as: 'profile' });
    // N:1 - O Convidado pode ser um User real, mas sua permissão é ligada ao GuestUser
    this.belongsTo(models.User, { foreignKey: 'invited_user_id', as: 'invitedUser' });
    // 1:1 - Cada GuestUser tem um conjunto de permissões (criamos o GuestPermission abaixo)
    this.hasOne(models.GuestPermission, { foreignKey: 'guest_user_id', as: 'permissions' });
  }
}

module.exports = GuestUser;