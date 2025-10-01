// src/features/ProfileManager/profile.controller.js
const { Profile } = require('../../models');
const logger = require('../../utils/logger');

class ProfileController {
  
  // POST /profiles
  async create(req, res) {
    const { name, image_url } = req.body;
    const user_id = req.userId; // Pego do auth.middleware

    if (!name) {
      return res.status(400).json({ error: 'O nome do perfil é obrigatório.' });
    }

    try {
      const profile = await Profile.create({ name, image_url, user_id });
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
      const profiles = await Profile.findAll({
        where: { user_id },
        // Inclui o grupo monitorado para exibir o status no Front-end
        include: [{ 
            model: req.app.locals.models.MonitoredGroup, // Acessa o modelo via locals
            as: 'monitoredGroup', 
            attributes: ['id', 'group_id', 'name', 'is_active'] 
        }],
        order: [['id', 'ASC']]
      });
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
      const profile = await Profile.findOne({ where: { id, user_id } });
      if (!profile) {
        return res.status(404).json({ error: 'Perfil não encontrado.' });
      }

      await profile.update({ name, image_url });
      res.status(200).json(profile);
    } catch (error) {
      logger.error('[ProfileController] Erro ao atualizar perfil:', error);
      res.status(500).json({ error: 'Erro ao atualizar perfil.' });
    }
  }

  // DELETE /profiles/:id
  async delete(req, res) {
    const { id } = req.params;
    const user_id = req.userId;

    try {
      const profile = await Profile.findOne({ where: { id, user_id } });
      if (!profile) {
        return res.status(404).json({ error: 'Perfil não encontrado.' });
      }
      
      // DELETA em cascata (se configurado, senão falhará se houver expenses/revenues/monitoredGroup)
      // Como o Sequelize não faz CASCADE por padrão, faremos um destroy simples, assumindo que as FKs no BD estão configuradas com ON DELETE CASCADE, ou o banco de dados falhará (o que é OK para notificar o dev).
      await profile.destroy();
      res.status(200).json({ message: 'Perfil e todos os dados associados deletados com sucesso.' });
    } catch (error) {
      logger.error('[ProfileController] Erro ao deletar perfil:', error);
      res.status(500).json({ error: 'Erro ao deletar perfil (verifique despesas associadas).' });
    }
  }
}

module.exports = new ProfileController();