// src/features/GroupManager/group.service.js

const { MonitoredGroup, User } = require('../../models'); 
const whatsappService = require('../../utils/whatsappService'); // Manter para outras funções
const subscriptionService = require('../../services/subscriptionService'); 
const groupManagerService = require('../../services/GroupManagerService'); // <<< NOVO: IMPORTAR MANAGER
const logger = require('../../utils/logger');
const { Op } = require('sequelize');

class GroupService {
  
  // REMOVIDO: listAllGroupsFromWhatsapp (Substituído pelo GroupManagerService.getAllGroupsFromCache)
  // REMOVIDO: listUserGroups (Substituído pelo GroupManagerService.findUserGroups)
  
  /**
   * NOVO: Lista apenas os grupos onde o usuário logado (via seu número de WhatsApp) é participante.
   * @param {number} userId - O ID do usuário logado.
   * @returns {Promise<Array>} Lista de grupos filtrados.
   */
  async listUserGroups(userId) {
    // 1. Obter o número de WhatsApp do usuário logado e verificar Admin
    const user = await User.findByPk(userId);
    const userPhone = user?.whatsapp_phone ? user.whatsapp_phone.replace(/[^0-9]/g, '') : null;
    const isAdmin = user?.email === 'fabio@gmail.com'; 

    if (!userPhone) {
        if (!isAdmin) {
             throw new Error("O número de WhatsApp do seu perfil é obrigatório para listar grupos. Por favor, configure-o em Configurações.");
        }
        // Se for Admin e sem número, retorna TODOS os grupos do CACHE
        logger.warn('[GroupService] Usuário Admin (fabio@gmail.com) está sem número de WhatsApp. Retornando TODOS os grupos do cache.');
        return groupManagerService.getAllGroupsFromCache();
    }
    
    // 2. Busca os grupos do usuário pelo número no CACHE
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

    // Validação de Assinatura
    const isActive = await subscriptionService.isUserActive(userId);
    if (!isActive) {
      throw new Error('Acesso negado: É necessário ter um plano ativo para monitorar um novo grupo.');
    }

    // CRÍTICO: Buscar apenas os grupos do usuário (para validação do grupoId)
    const allGroups = await this.listUserGroups(userId); 

    if (!allGroups) {
        throw new Error('Falha ao buscar a lista de grupos do cache. Tente novamente.');
    }

    // Verificar se o grupo selecionado ESTÁ na lista filtrada
    const groupDetails = allGroups.find(g => g.phone === groupId);
    if (!groupDetails) {
        throw new Error(`Grupo com ID ${groupId} não foi encontrado na sua lista de grupos do WhatsApp. Verifique se você está no grupo.`);
    }

    // Desativar todos os outros grupos *DO MESMO PERFIL*
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