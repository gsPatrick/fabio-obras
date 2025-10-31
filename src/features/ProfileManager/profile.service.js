// src/features/ProfileManager/profile.service.js
const { Profile, MonitoredGroup, Category } = require('../../models');
const subscriptionService = require('../../services/subscriptionService');
const logger = require('../../utils/logger');

/**
 * Cria as categorias essenciais para um novo perfil.
 * @param {number} profileId - O ID do perfil recém-criado.
 */
async function _seedEssentialCategoriesForNewProfile(profileId) {
    if (!profileId) return;
    try {
        const essentialCategories = [
            { name: 'Outros', type: 'Outros', category_flow: 'expense' },
            { name: 'Receita Padrão', type: 'Receita', category_flow: 'revenue' },
        ];
        logger.info(`[ProfileService] Criando categorias essenciais para o perfil ${profileId}...`);
        for (const categoryData of essentialCategories) {
            await Category.findOrCreate({
                where: { name: categoryData.name, profile_id: profileId, category_flow: categoryData.category_flow },
                defaults: { ...categoryData, profile_id: profileId },
            });
        }
    } catch (error) {
        logger.error(`[ProfileService] Falha ao criar categorias essenciais para o perfil ${profileId}:`, error);
    }
}


class ProfileService {
  /**
   * Cria um novo perfil para um usuário e popula com categorias essenciais.
   */
  async createProfile(data) {
    const { name, image_url, user_id } = data;

    // 1. Valida o limite de perfis da assinatura do usuário.
    await subscriptionService._checkProfileLimit(user_id);
    
    // 2. Cria o perfil.
    const newProfile = await Profile.create({ name, image_url, user_id });

    // 3. <<< MUDANÇA CRÍTICA >>> Adiciona as categorias padrão ao novo perfil.
    await _seedEssentialCategoriesForNewProfile(newProfile.id);

    return newProfile;
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
    
    // A lógica de CASCADE DELETE configurada nos models cuidará da exclusão dos dados associados.
    await profile.destroy();
  }
}

module.exports = new ProfileService();