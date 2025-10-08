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
async startMonitoringGroup(groupId, profileId, userId, groupName) { // <<< Adicionado groupName
    if (!groupId || !profileId || !userId) {
      throw new Error('O ID do grupo, perfil e usuário são obrigatórios.');
    }

    const isActive = await subscriptionService.isUserActive(userId);
    if (!isActive) {
      throw new Error('Acesso negado: É necessário ter um plano ativo para monitorar um novo grupo.');
    }

    // <<< INÍCIO DA MUDANÇA CRÍTICA: REMOVER A VALIDAÇÃO CONTRA O CACHE >>>
    // Em vez de buscar no cache, vamos usar o nome do grupo que já sabemos pelo webhook.
    // Se o groupName não for passado (ex: via API web), aí sim buscamos os metadados.
    let finalGroupName = groupName;
    if (!finalGroupName) {
        const groupDetails = await whatsappService.getGroupMetadata(groupId);
        if (!groupDetails || !groupDetails.name) {
            throw new Error(`Não foi possível obter o nome do grupo com ID ${groupId}.`);
        }
        finalGroupName = groupDetails.name;
    }
    // <<< FIM DA MUDANÇA CRÍTICA >>>

    await MonitoredGroup.update(
        { is_active: false }, 
        { 
            where: { 
                profile_id: profileId, 
                group_id: { [Op.not]: groupId },
                is_active: true
            } 
        }
    );
    logger.info(`[GroupService] Todos os grupos ativos foram desativados para o Perfil ${profileId}, exceto o novo.`);

    const [monitoredGroup, created] = await MonitoredGroup.findOrCreate({
      where: { group_id: groupId, profile_id: profileId }, 
      defaults: {
        name: finalGroupName, // <<< Usar o nome obtido
        is_active: true,
        profile_id: profileId, 
      },
    });

    if (!created) {
      monitoredGroup.is_active = true;
      monitoredGroup.name = finalGroupName; // Garante que o nome está atualizado
      await monitoredGroup.save();
      logger.info(`[GroupService] Monitoramento REATIVADO (e único) para o grupo: ${finalGroupName} no Perfil ${profileId}`);
      return { message: 'Monitoramento reativado com sucesso para este perfil. Outros grupos deste perfil desativados.', group: monitoredGroup };
    }
    
    logger.info(`[GroupService] Novo monitoramento iniciado (e único) para o grupo: ${finalGroupName} no Perfil ${profileId}`);
    return { message: 'Grupo adicionado ao monitoramento com sucesso para este perfil. Outros grupos deste perfil desativados.', group: monitoredGroup };
  }

}

module.exports = new GroupService();