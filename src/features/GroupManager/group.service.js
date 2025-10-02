const { MonitoredGroup, User } = require('../../models');
const whatsappService = require('../../utils/whatsappService');
const subscriptionService = require('../../services/subscriptionService'); 
const logger = require('../../utils/logger');
const { Op } = require('sequelize');

class GroupService {
  /**
   * Busca todos os grupos na instância do WhatsApp (sem filtro).
   * @returns {Promise<Array|null>} Uma lista de objetos de grupo.
   */
  async listAllGroupsFromWhatsapp() {
    const allGroups = await whatsappService.listGroups();
    
    if (!allGroups) {
      logger.error('[GroupService] Não foi possível obter a lista de grupos do WhatsApp.');
      return null;
    }
    // A API já retorna apenas grupos
    return allGroups.filter(chat => chat.isGroup);
  }

  /**
   * NOVO: Lista apenas os grupos onde o usuário logado (via seu número de WhatsApp) é participante.
   * @param {number} userId - O ID do usuário logado.
   * @returns {Promise<Array>} Lista de grupos filtrados.
   */
  async listUserGroups(userId) {
    // 1. Obter o número de WhatsApp do usuário logado
    const user = await User.findByPk(userId);
    // Remove caracteres não numéricos e o '+' inicial, mantendo apenas DDI+DDD+Numero
    const userPhone = user?.whatsapp_phone ? user.whatsapp_phone.replace(/[^0-9]/g, '') : null;

    if (!userPhone) {
        throw new Error("O número de WhatsApp do seu perfil é obrigatório para listar grupos. Por favor, configure-o em Configurações.");
    }
    
    // 2. Obter a lista COMPLETA de grupos da instância
    const allGroups = await this.listAllGroupsFromWhatsapp();
    if (!allGroups || allGroups.length === 0) {
        return [];
    }

    // 3. Filtrar grupos onde o usuário é participante
    const userGroups = [];
    for (const group of allGroups) {
        // Obter os metadados do grupo para ter a lista de participantes
        const metadata = await whatsappService.getGroupMetadata(group.phone);
        
        if (metadata && metadata.participants) {
            // A API Z-API retorna o telefone no formato DDI+DDD+Numero (sem o '+')
            const participant = metadata.participants.find(p => p.phone === userPhone);
            
            if (participant) {
                userGroups.push(group);
            }
        }
    }
    
    logger.info(`[GroupService] Filtragem de grupos concluída. ${userGroups.length} grupo(s) encontrado(s) para o usuário ${userPhone}.`);
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

    // ===================================================================
    // <<< VALIDAÇÃO DE ASSINATURA CRÍTICA >>>
    // ===================================================================
    const isActive = await subscriptionService.isUserActive(userId);
    if (!isActive) {
      throw new Error('Acesso negado: É necessário ter um plano ativo para monitorar um novo grupo.');
    }
    // ===================================================================

    // CRÍTICO: Buscar apenas os grupos onde o usuário é participante
    const allGroups = await this.listUserGroups(userId); 

    if (!allGroups) {
        throw new Error('Falha ao buscar a lista de grupos da Z-API. Verifique os logs.');
    }

    // Verificar se o grupo selecionado ESTÁ na lista filtrada
    const groupDetails = allGroups.find(g => g.phone === groupId);
    if (!groupDetails) {
        throw new Error(`Grupo com ID ${groupId} não foi encontrado na sua lista de grupos do WhatsApp. Verifique se você está no grupo.`);
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