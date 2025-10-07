// src/services/GroupManagerService.js
const axios = require('axios');
const logger = require('../utils/logger');
const { ZAPI_INSTANCE_ID, ZAPI_TOKEN, ZAPI_CLIENT_TOKEN } = process.env;

const BASE_URL = `https://api.z-api.io/instances/${ZAPI_INSTANCE_ID}/token/${ZAPI_TOKEN}`;
const headers = { 'Content-Type': 'application/json', 'client-token': ZAPI_CLIENT_TOKEN };

// <<< NOVO: Função de delay para usar entre as chamadas >>>
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

class GroupManagerService {
    constructor() {
        this.groupsCache = new Map();
        this.userGroupsIndex = new Map();
        this.lastUpdate = null;
        this.CACHE_DURATION = 5 * 60 * 1000;
        
        this.startCacheWorker();
    }
    
    _formatPhone(phone) {
        if (!phone) return '';
        const cleanedPhone = phone.replace(/[^0-g]/g, '');
        if (!cleanedPhone.startsWith('55') && (cleanedPhone.length === 10 || cleanedPhone.length === 11)) {
            return `55${cleanedPhone}`;
        }
        return cleanedPhone;
    }

    async updateCache() {
        if (this.lastUpdate && (Date.now() - this.lastUpdate) < this.CACHE_DURATION) {
            return;
        }

        logger.info('⚙️ [CacheWorker] Iniciando atualização de cache de grupos...');
        
        this.groupsCache.clear();
        this.userGroupsIndex.clear();
        let groupsFetched = 0;

        try {
            const params = { pageSize: 500 };
            const listResponse = await axios.get(`${BASE_URL}/groups`, { headers, params });
            const groups = listResponse.data || [];

            logger.info(`[CacheWorker] ${groups.length} grupos encontrados. Buscando participantes sequencialmente...`);
            
            // ===================================================================
            // <<< MUDANÇA CRÍTICA: Substituindo Promise.all por um loop for...of com delay >>>
            // Isso evita sobrecarregar a API da Z-API com requisições simultâneas.
            // ===================================================================
            for (const group of groups) {
                try {
                    const groupMetadata = await axios.get(
                        `${BASE_URL}/group-metadata/${group.phone}`,
                        { headers }
                    );
                    
                    const participants = groupMetadata.data.participants || [];
                    
                    this.groupsCache.set(group.phone, { id: group.phone, name: group.name });

                    participants.forEach(participant => {
                        const phone = this._formatPhone(participant.phone); 
                        if (phone) {
                            if (!this.userGroupsIndex.has(phone)) {
                                this.userGroupsIndex.set(phone, new Set());
                            }
                            this.userGroupsIndex.get(phone).add(group.phone);
                        }
                    });
                    groupsFetched++;
                } catch (error) {
                    // Loga o erro mas continua o loop para os outros grupos
                    logger.error(`[CacheWorker] Erro ao buscar participantes do grupo ${group.phone}: ${error.message}`);
                }
                
                // <<< Adiciona um pequeno atraso de 250ms entre cada chamada >>>
                await delay(250); 
            }
            // ===================================================================
            // Fim da mudança
            // ===================================================================

            this.lastUpdate = Date.now();
            logger.info(`✅ [CacheWorker] Cache atualizado. ${groupsFetched} de ${groups.length} grupos processados com sucesso.`);
        } catch (error) {
            logger.error('[CacheWorker] Erro crítico ao buscar a lista principal de grupos:', error.message);
            // Não lança o erro para não quebrar o worker, ele tentará novamente na próxima vez
        }
    }

    async findUserGroups(phone) {
        // Se o cache ainda não foi populado, força uma atualização
        if (this.groupsCache.size === 0) {
            await this.updateCache();
        }
        const formattedPhone = this._formatPhone(phone);
        const groupIds = this.userGroupsIndex.get(formattedPhone);

        if (!groupIds) return [];

        return Array.from(groupIds).map(groupId => {
            const group = this.groupsCache.get(groupId);
            return { phone: group.id, name: group.name };
        });
    }

    async getAllGroupsFromCache() {
        // Se o cache ainda não foi populado, força uma atualização
        if (this.groupsCache.size === 0) {
            await this.updateCache();
        }
        return Array.from(this.groupsCache.values()).map(group => ({
            phone: group.id,
            name: group.name
        }));
    }

    startCacheWorker() {
        this.updateCache().catch(err => logger.error("Falha inicial ao carregar cache de grupos.", err)); 
        setInterval(() => this.updateCache().catch(err => logger.error("Worker falhou ao atualizar cache.", err)), this.CACHE_DURATION);
    }
}

module.exports = new GroupManagerService();