const { MonitoredGroup } = require('../../models');
const whatsappService = require('../../utils/whatsappService');
const logger = require('../../utils/logger');

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
   * Adiciona um grupo à lista de monitoramento no banco de dados.
   * @param {string} groupId - O ID do grupo (ex: '120363419423704711-group').
   * @returns {Promise<object>}
   */
  async startMonitoringGroup(groupId) {
    if (!groupId) {
      throw new Error('O ID do grupo é obrigatório.');
    }

    const allGroups = await this.listAllGroupsFromWhatsapp();
    // Adicionado um log para depuração
    if (!allGroups) {
        throw new Error('Falha ao buscar a lista de grupos da Z-API. Verifique os logs.');
    }

    const groupDetails = allGroups.find(g => g.phone === groupId); // <<< CORREÇÃO: o ID do grupo vem no campo "phone" na nova API

    if (!groupDetails) {
      throw new Error(`Grupo com ID ${groupId} não foi encontrado na sua instância do WhatsApp.`);
    }

    const [monitoredGroup, created] = await MonitoredGroup.findOrCreate({
      where: { group_id: groupDetails.phone }, // <<< CORREÇÃO
      defaults: {
        name: groupDetails.name,
        is_active: true,
      },
    });

    if (!created && !monitoredGroup.is_active) {
      monitoredGroup.is_active = true;
      await monitoredGroup.save();
      logger.info(`[GroupService] Monitoramento REATIVADO para o grupo: ${groupDetails.name}`);
      return { message: 'Monitoramento reativado com sucesso.', group: monitoredGroup };
    }

    if (!created) {
        logger.info(`[GroupService] O grupo ${groupDetails.name} já estava sendo monitorado.`);
        return { message: 'Este grupo já está sendo monitorado.', group: monitoredGroup };
    }
    
    logger.info(`[GroupService] Novo monitoramento iniciado para o grupo: ${groupDetails.name}`);
    return { message: 'Grupo adicionado ao monitoramento com sucesso.', group: monitoredGroup };
  }
}

module.exports = new GroupService();