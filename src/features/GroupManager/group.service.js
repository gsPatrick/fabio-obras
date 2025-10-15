// src/features/GroupManager/group.service.js - VERSÃO COMPLETA E CORRIGIDA

const { MonitoredGroup, User, Profile } = require('../../models');
const subscriptionService = require('../../services/subscriptionService'); 
const groupManagerService = require('../../utils/GroupManagerService');
const logger = require('../../utils/logger');
const { Op } = require('sequelize');
const whatsappService = require('../../utils/whatsappService');

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
   * Adiciona ou ATUALIZA um grupo à lista de monitoramento, garantindo que um perfil
   * só possa monitorar UM grupo por vez.
   * @param {string} groupId - O ID do novo grupo.
   * @param {number} profileId - O ID do perfil.
   * @param {number} userId - O ID do usuário (dono do perfil).
   * @param {string} groupName - O nome do novo grupo.
   * @returns {Promise<object>}
   */
  async startMonitoringGroup(groupId, profileId, userId, groupName) {
    if (!groupId || !profileId || !userId) {
      throw new Error('O ID do grupo, perfil e usuário são obrigatórios.');
    }

    const isActive = await subscriptionService.isUserActive(userId);
    if (!isActive) {
      throw new Error('Acesso negado: É necessário ter um plano ativo para monitorar um novo grupo.');
    }

    let finalGroupName = groupName;
    if (!finalGroupName) {
        const groupDetails = await whatsappService.getGroupMetadata(groupId);
        if (!groupDetails || !groupDetails.name) {
            throw new Error(`Não foi possível obter o nome do grupo com ID ${groupId}.`);
        }
        finalGroupName = groupDetails.name;
    }
    
    // LÓGICA DE CORREÇÃO:
    // Usamos findOrCreate baseado APENAS no profile_id.
    // Isso garante que estamos sempre operando sobre o ÚNICO registro de monitoramento
    // para aquele perfil.
    const [monitoredGroup, created] = await MonitoredGroup.findOrCreate({
      where: { profile_id: profileId }, 
      defaults: {
        group_id: groupId,
        name: finalGroupName,
        is_active: true,
      },
    });

    // Se o registro não foi criado, significa que ele já existia.
    // Portanto, devemos ATUALIZÁ-LO com as informações do novo grupo.
    if (!created) {
      await monitoredGroup.update({
        group_id: groupId,
        name: finalGroupName,
        is_active: true, // Garante que ele fique ativo
      });
      logger.info(`[GroupService] Monitoramento ATUALIZADO para o grupo: ${finalGroupName} no Perfil ${profileId}`);
      return { message: 'Monitoramento de grupo atualizado com sucesso.', group: monitoredGroup };
    }
    
    logger.info(`[GroupService] Novo monitoramento iniciado para o grupo: ${finalGroupName} no Perfil ${profileId}`);
    return { message: 'Grupo adicionado ao monitoramento com sucesso.', group: monitoredGroup };
  }

}

module.exports = new GroupService();