const { MonitoredGroup } = require('../../models');
const whatsappService = require('../../utils/whatsappService');
const subscriptionService = require('../../services/subscriptionService'); 
const logger = require('../../utils/logger');
const { Op } = require('sequelize');

class GroupService {
  /**
   * Busca todos os grupos na instância do WhatsApp.
   * @returns {Promise<Array|null>} Uma lista de objetos de grupo.
   */
  async listAllGroupsFromWhatsapp() {
    // <<< MUDANÇA: Chamando a nova função correta do whatsappService >>>
    const allGroups = await whatsappService.listGroups();
    
    if (!allGroups) {
      logger.error('[GroupService] Não foi possível obter a lista de grupos do WhatsApp.');
      return null;
    }
    // A API já retorna apenas grupos, então o filtro não é mais estritamente necessário, mas mantemos por segurança.
    return allGroups.filter(chat => chat.isGroup);
  }

  /**
   * Adiciona um grupo à lista de monitoramento no banco de dados, associado a um Perfil.
   * CRÍTICO: Agora exige uma assinatura ativa do usuário.
   * @param {string} groupId - O ID do grupo.
   * @param {number} profileId - O ID do perfil.
   * @param {number} userId - O ID do usuário (dono do perfil).
   * @returns {Promise<object>}
   */
  async startMonitoringGroup(groupId, profileId, userId) {
    if (!groupId || !profileId || !userId) {
      throw new Error('O ID do grupo, perfil e usuário são obrigatórios.');
    }

    // ===================================================================
    // <<< VALIDAÇÃO DE ASSINATURA CRÍTICA >>>
    // ===================================================================
    const isActive = await subscriptionService.isUserActive(userId);
    if (!isActive) {
      throw new Error('Acesso negado: É necessário ter um plano ativo para monitorar um novo grupo.');
    }
    // ===================================================================

    const allGroups = await this.listAllGroupsFromWhatsapp();
    // Adicionado um log para depuração
    if (!allGroups) {
        throw new Error('Falha ao buscar a lista de grupos da Z-API. Verifique os logs.');
    }

    const groupDetails = allGroups.find(g => g.phone === groupId); // O ID do grupo vem no campo "phone"
    if (!groupDetails) {
      throw new Error(`Grupo com ID ${groupId} não foi encontrado na sua instância do WhatsApp.`);
    }

    // ===================================================================
    // <<< MUDANÇA CRÍTICA: Desativar todos os outros grupos *DO MESMO PERFIL* >>>
    // ===================================================================
    await MonitoredGroup.update(
        { is_active: false }, 
        { 
            where: { 
                profile_id: profileId, // Restringir ao perfil atual
                group_id: { [Op.not]: groupDetails.phone },
                is_active: true
            } 
        }
    );
    logger.info(`[GroupService] Todos os grupos ativos foram desativados para o Perfil ${profileId}, exceto o novo.`);
    // ===================================================================

    const [monitoredGroup, created] = await MonitoredGroup.findOrCreate({
      where: { group_id: groupDetails.phone, profile_id: profileId }, // CRÍTICO: Buscar pelo par (grupo, perfil)
      defaults: {
        name: groupDetails.name,
        is_active: true,
        profile_id: profileId, // Adicionar profile_id nos defaults
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