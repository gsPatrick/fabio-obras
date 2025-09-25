const { MonitoredGroup } = require('../../models');
const whatsappService = require('../../utils/whatsappService');
const logger = require('../../utils/logger');
class GroupService {
/**
Busca todos os grupos na instância do WhatsApp.
@returns {Promise<Array|null>} Uma lista de objetos de grupo.
*/
async listAllGroupsFromWhatsapp() {
const allChats = await whatsappService.listChats();
if (!allChats) {
return null;
}
// Filtramos para retornar apenas os que são grupos
return allChats.filter(chat => chat.isGroup);
}
/**
Adiciona um grupo à lista de monitoramento no banco de dados.
@param {string} groupId - O ID do grupo (ex: '120363419423704711-group').
@returns {Promise<object>}
*/
async startMonitoringGroup(groupId) {
if (!groupId) {
throw new Error('O ID do grupo é obrigatório.');
}
const allGroups = await this.listAllGroupsFromWhatsapp();
const groupDetails = allGroups.find(g => g.id === groupId);

if (!groupDetails) {
  throw new Error(`Grupo com ID ${groupId} não foi encontrado na sua instância do WhatsApp.`);
}

// Usamos findOrCreate para evitar duplicatas.
// Ele encontra um registro ou cria um novo se não existir.
const [monitoredGroup, created] = await MonitoredGroup.findOrCreate({
  where: { group_id: groupDetails.id },
  defaults: {
    name: groupDetails.name,
    is_active: true,
  },
});

if (!created && !monitoredGroup.is_active) {
  // Se o grupo já existia mas estava inativo, reativa ele.
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