// src/features/ProfileManager/profile.service.js
const { Profile, MonitoredGroup } = require('../../models');

class ProfileService {
  /**
   * Cria um novo perfil para um usuário.
   */
  async createProfile(data) {
    const { name, image_url, user_id } = data;
    return Profile.create({ name, image_url, user_id });
  }

  /**
   * Lista todos os perfis de um usuário, incluindo o grupo monitorado.
   */
  async getProfilesByUserId(userId) {
    // Nota: O MonitoredGroup precisa ser incluído diretamente
    // Aqui usamos o import direto no service, que é mais robusto
    return Profile.findAll({
      where: { user_id: userId },
      include: [{ 
        model: MonitoredGroup, 
        as: 'monitoredGroup', 
        attributes: ['id', 'group_id', 'name', 'is_active'] 
      }],
      order: [['id', 'ASC']]
    });
  }
  
  /**
   * Atualiza um perfil existente.
   */
  async updateProfile(profileId, userId, data) {
    const profile = await Profile.findOne({ where: { id: profileId, user_id: userId } });
    if (!profile) throw new Error('Perfil não encontrado.');
    
    await profile.update(data);
    return profile;
  }

  /**
   * Deleta um perfil.
   */
  async deleteProfile(profileId, userId) {
    const profile = await Profile.findOne({ where: { id: profileId, user_id: userId } });
    if (!profile) throw new Error('Perfil não encontrado.');
    
    await profile.destroy();
  }
}

module.exports = new ProfileService();