// src/features/GroupManager/group.service.js

const { MonitoredGroup, User } = require('../../models'); 
const subscriptionService = require('../../services/subscriptionService'); 
const groupManagerService = require('../../utils/GroupManagerService');
const logger = require('../../utils/logger');
const { Op } = require('sequelize');

class GroupService {
  
  /**
   * Lista os grupos. Se o usuário for Admin, retorna TODOS os grupos do cache.
   * Se for um usuário comum, retorna apenas os grupos onde ele é participante.
   * @param {number} userId - O ID do usuário logado.
   * @returns {Promise<Array>} Lista de grupos.
   */
  async listUserGroups(userId) {
    // 1. Obter dados do usuário e verificar se é admin
    const user = await User.findByPk(userId);
    const isAdmin = user?.email === 'fabio@gmail.com'; 

    // <<< MUDANÇA CRÍTICA: A verificação de admin vem PRIMEIRO.
    // Se for o admin, ignora qualquer outra lógica e retorna a lista completa.
    if (isAdmin) {
      logger.info(`[GroupService] Acesso de Administrador ('${user.email}'). Retornando TODOS os grupos do cache.`);
      return groupManagerService.getAllGroupsFromCache();
    }
    
    // 2. Lógica para usuários normais (só executa se não for admin)
    const userPhone = user?.whatsapp_phone ? user.whatsapp_phone.replace(/[^0-9]/g, '') : null;

    if (!userPhone) {
      throw new Error("O número de WhatsApp do seu perfil é obrigatório para listar grupos. Por favor, configure-o em Configurações.");
    }
    
    // 3. Busca os grupos do usuário comum pelo seu número no cache
    logger.info(`[GroupService] Buscando grupos para o usuário comum com telefone final...${userPhone.slice(-4)}`);
    const userGroups = await groupManagerService.findUserGroups(userPhone);

    return userGroups;
  }

  /**
   * Adiciona um grupo à lista de monitoramento no banco de dados, associado a um Perfil.
   * @param {string} groupId - O ID do grupo.
   * @param {number} profileId - O ID do perfil.
   * @param {number} userId - O ID do usuário (dono do perfil).
   * @returns {Promise<object>}
   */
  async startMonitoringGroup(groupId, profileId, userId) {
    if (!groupId || !profileId || !userId) {
      throw new Error('O ID do grupo, perfil e usuário são obrigatórios.');
    }

    const isActive = await subscriptionService.isUserActive(userId);
    if (!isActive) {
      throw new Error('Acesso negado: É necessário ter um plano ativo para monitorar um novo grupo.');
    }

    // A chamada a listUserGroups aqui agora funcionará corretamente para o admin,
    // retornando todos os grupos para a validação do 'groupDetails'.
    const allAvailableGroups = await this.listUserGroups(userId); 

    if (!allAvailableGroups) {
        throw new Error('Falha ao buscar a lista de grupos do cache. Tente novamente.');
    }

    const groupDetails = allAvailableGroups.find(g => g.phone === groupId);
    if (!groupDetails) {
        throw new Error(`Grupo com ID ${groupId} não foi encontrado na sua lista de grupos disponíveis. Verifique se o bot está no grupo.`);
    }

    await MonitoredGroup.update(
        { is_active: false }, 
        { 
            where: { 
                profile_id: profileId, 
                group_id: { [Op.not]: groupDetails.phone },
                is_active: true
            } 
        }
    );
    logger.info(`[GroupService] Todos os grupos ativos foram desativados para o Perfil ${profileId}, exceto o novo.`);

    const [monitoredGroup, created] = await MonitoredGroup.findOrCreate({
      where: { group_id: groupDetails.phone, profile_id: profileId }, 
      defaults: {
        name: groupDetails.name,
        is_active: true,
        profile_id: profileId, 
      },
    });

    if (!created && !monitoredGroup.is_active) {
      monitoredGroup.is_active = true;
      await monitoredGroup.save();
      logger.info(`[GroupService] Monitoramento REATIVADO (e único) para o grupo: ${groupDetails.name} no Perfil ${profileId}`);
      return { message: 'Monitoramento reativado com sucesso para este perfil. Outros grupos deste perfil desativados.', group: monitoredGroup };
    }

    if (!created) {
        logger.info(`[GroupService] O grupo ${groupDetails.name} já estava sendo monitorado pelo Perfil ${profileId} e agora é o único ativo.`);
        return { message: 'Este grupo já está sendo monitorado por este perfil (e agora é o único ativo).', group: monitoredGroup };
    }
    
    logger.info(`[GroupService] Novo monitoramento iniciado (e único) para o grupo: ${groupDetails.name} no Perfil ${profileId}`);
    return { message: 'Grupo adicionado ao monitoramento com sucesso para este perfil. Outros grupos deste perfil desativados.', group: monitoredGroup };
  }
}

module.exports = new GroupService();