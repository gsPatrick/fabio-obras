// src/services/GroupManagerService.js
const axios = require('axios');
const logger = require('../utils/logger');
const { ZAPI_INSTANCE_ID, ZAPI_TOKEN, ZAPI_CLIENT_TOKEN } = process.env;

const BASE_URL = `https://api.z-api.io/instances/${ZAPI_INSTANCE_ID}/token/${ZAPI_TOKEN}`;
const headers = { 'Content-Type': 'application/json', 'client-token': ZAPI_CLIENT_TOKEN };

class GroupManagerService {
    constructor() {
        this.groupsCache = new Map();
        this.userGroupsIndex = new Map();
        this.lastUpdate = null;
        this.CACHE_DURATION = 5 * 60 * 1000; // 5 minutos
        
        this.startCacheWorker();
    }
    
    _formatPhone(phone) {
        if (!phone) return '';
        const cleanedPhone = phone.replace(/[^0-9]/g, '');
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
            logger.info('[CacheWorker] Buscando todos os chats para encontrar os grupos...');
            const listResponse = await axios.get(`${BASE_URL}/chats`, { headers });
            
            // ===================================================================
            // <<< CORREÇÃO: Lendo a resposta de 'response.data.chats' como indicado pela Z-API >>>
            // Isso resolve o problema da lista vazia.
            // ===================================================================
            const allChats = listResponse.data.chats || []; 
            const groups = allChats.filter(chat => chat.isGroup);

            logger.info(`[CacheWorker] ${groups.length} grupos encontrados na lista de chats.`);
            
            await Promise.all(groups.map(async (group) => {
                try {
                    const groupMetadata = await axios.get(
                        `${BASE_URL}/group-metadata/${group.phone}`,
                        { headers }
                    );
                    
                    const participants = groupMetadata.data.participants || [];
                    
                    this.groupsCache.set(group.phone, {
                        id: group.phone,
                        name: group.name,
                    });

                    participants.forEach(participant => {
                        const phone = this._formatPhone(participant.phone); 
                        if (phone && !this.userGroupsIndex.has(phone)) {
                            this.userGroupsIndex.set(phone, new Set());
                        }
                        if(phone) this.userGroupsIndex.get(phone).add(group.phone);
                    });
                    groupsFetched++;
                } catch (error) {
                    logger.error(`[CacheWorker] Erro ao buscar participantes do grupo ${group.phone}:`, error.message);
                }
            }));

            this.lastUpdate = Date.now();
            logger.info(`✅ [CacheWorker] Cache atualizado. ${groupsFetched} grupos processados.`);
        } catch (error) {
            logger.error('[CacheWorker] Erro crítico ao buscar lista de chats:', error.message);
            throw new Error(`Falha ao conectar com a API do WhatsApp para atualizar o cache: ${error.message}`);
        }
    }

    async findUserGroups(phone) {
        await this.updateCache();
        const formattedPhone = this._formatPhone(phone);
        const groupIds = this.userGroupsIndex.get(formattedPhone);

        if (!groupIds) return [];

        return Array.from(groupIds).map(groupId => {
            const group = this.groupsCache.get(groupId);
            return {
                phone: group.id,
                name: group.name
            };
        });
    }

    async getAllGroupsFromCache() {
        await this.updateCache();
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