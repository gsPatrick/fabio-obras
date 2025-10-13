// src/features/ProfileManager/profile.service.js
const { Profile, MonitoredGroup } = require('../../models');
// <<< IMPORTAR O SERVIÇO DE ASSINATURA >>>
const subscriptionService = require('../../services/subscriptionService');

class ProfileService {
  /**
   * Cria um novo perfil para um usuário.
   * <<< LÓGICA DE VALIDAÇÃO ADICIONADA AQUI >>>
   */
  async createProfile(data) {
    const { name, image_url, user_id } = data;

    // 1. Chamar a validação de limite de perfis ANTES de criar.
    // O método _checkProfileLimit lançará um erro se o limite for atingido.
    // Tornamos o método público no service para poder ser chamado aqui.
    await subscriptionService._checkProfileLimit(user_id);
    
    // 2. Se a validação passar, cria o perfil normalmente.
    return Profile.create({ name, image_url, user_id });
  }

  /**
   * Lista todos os perfis de um usuário, incluindo o grupo monitorado.
   */
  async getProfilesByUserId(userId) {
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
    
    // IMPORTANTE: A lógica de CASCADE DELETE no banco de dados deve
    // cuidar da exclusão de todos os dados associados (despesas, receitas, etc.).
    await profile.destroy();
  }
}

module.exports = new ProfileService();