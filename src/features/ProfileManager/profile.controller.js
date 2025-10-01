
// src/features/ProfileManager/profile.controller.js
const profileService = require('./profile.service'); // <<< IMPORTAR O SERVIÇO
const logger = require('../../utils/logger');

class ProfileController {
  
  // POST /profiles
  async create(req, res) {
    const { name, image_url } = req.body;
    const user_id = req.userId;

    if (!name) {
      return res.status(400).json({ error: 'O nome do perfil é obrigatório.' });
    }

    try {
      const profile = await profileService.createProfile({ name, image_url, user_id }); // <<< USAR SERVIÇO
      res.status(201).json(profile);
    } catch (error) {
      logger.error('[ProfileController] Erro ao criar perfil:', error);
      res.status(500).json({ error: 'Erro ao criar perfil.' });
    }
  }

  // GET /profiles
  async findAll(req, res) {
    const user_id = req.userId;

    try {
      const profiles = await profileService.getProfilesByUserId(user_id); // <<< USAR SERVIÇO
      res.status(200).json(profiles);
    } catch (error) {
      logger.error('[ProfileController] Erro ao listar perfis:', error);
      res.status(500).json({ error: 'Erro ao listar perfis.' });
    }
  }

  // PUT /profiles/:id
  async update(req, res) {
    const { id } = req.params;
    const { name, image_url } = req.body;
    const user_id = req.userId;

    try {
      const profile = await profileService.updateProfile(id, user_id, { name, image_url }); // <<< USAR SERVIÇO
      res.status(200).json(profile);
    } catch (error) {
      logger.error('[ProfileController] Erro ao atualizar perfil:', error);
      res.status(404).json({ error: error.message });
    }
  }

  // DELETE /profiles/:id
  async delete(req, res) {
    const { id } = req.params;
    const user_id = req.userId;

    try {
      await profileService.deleteProfile(id, user_id); // <<< USAR SERVIÇO
      res.status(200).json({ message: 'Perfil e todos os dados associados deletados com sucesso.' });
    } catch (error) {
      logger.error('[ProfileController] Erro ao deletar perfil:', error);
      res.status(500).json({ error: 'Erro ao deletar perfil.' });
    }
  }
}

module.exports = new ProfileController();