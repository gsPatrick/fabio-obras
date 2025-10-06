// src/services/GroupManagerService.js
const axios = require('axios');
const logger = require('../utils/logger');
const { ZAPI_INSTANCE_ID, ZAPI_TOKEN, ZAPI_CLIENT_TOKEN } = process.env;

const BASE_URL = `https://api.z-api.io/instances/${ZAPI_INSTANCE_ID}/token/${ZAPI_TOKEN}`;
const headers = { 'Content-Type': 'application/json', 'client-token': ZAPI_CLIENT_TOKEN };

class GroupManagerService {
    constructor() {
        this.groupsCache = new Map(); // Cache dos grupos: {groupId -> {id, name}}
        this.userGroupsIndex = new Map(); // Índice inverso: {phone -> Set<groupId>}
        this.lastUpdate = null;
        this.CACHE_DURATION = 5 * 60 * 1000; // 5 minutos (300,000 ms)
        
        // Inicia o worker de atualização do cache
        this.startCacheWorker();
    }
    
    /**
     * Remove caracteres de formatação do telefone e garante DDI+DDD+Numero.
     */
    _formatPhone(phone) {
        if (!phone) return '';
        const cleanedPhone = phone.replace(/[^0-9]/g, '');

        if (!cleanedPhone.startsWith('55') && (cleanedPhone.length === 10 || cleanedPhone.length === 11)) {
            return `55${cleanedPhone}`;
        }
        
        return cleanedPhone;
    }

    /**
     * Atualiza o cache de grupos e o índice de usuários.
     * @returns {Promise<void>}
     */
    async updateCache() {
        if (this.lastUpdate && (Date.now() - this.lastUpdate) < this.CACHE_DURATION) {
            return;
        }

        logger.info('⚙️ [CacheWorker] Iniciando atualização de cache de grupos...');
        
        this.groupsCache.clear();
        this.userGroupsIndex.clear();
        let groupsFetched = 0;

        try {
            // Adiciona 'params' para pedir até 500 grupos de uma vez para resolver a paginação.
            const params = { pageSize: 500 };
            const listResponse = await axios.get(`${BASE_URL}/groups`, { headers, params });
            
            // A resposta de /groups já é um array direto de grupos
            const groups = listResponse.data || [];

            logger.info(`[CacheWorker] ${groups.length} grupos encontrados na API.`);
            
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
                        if (phone) {
                            if (!this.userGroupsIndex.has(phone)) {
                                this.userGroupsIndex.set(phone, new Set());
                            }
                            this.userGroupsIndex.get(phone).add(group.phone);
                        }
                    });
                    groupsFetched++;
                } catch (error) {
                    logger.error(`[CacheWorker] Erro ao buscar participantes do grupo ${group.phone}:`, error.message);
                }
            }));

            this.lastUpdate = Date.now();
            logger.info(`✅ [CacheWorker] Cache atualizado. ${groupsFetched} grupos processados.`);
        } catch (error) {
            logger.error('[CacheWorker] Erro crítico ao buscar lista de grupos:', error.message);
            throw new Error(`Falha ao conectar com a API do WhatsApp para atualizar o cache: ${error.message}`);
        }
    }

    /**
     * Busca os grupos de um usuário no índice, utilizando o cache.
     * @param {string} phone - O número de WhatsApp do usuário (DDI+DDD+Numero).
     * @returns {Array<object>} Lista de grupos que o usuário participa.
     */
    async findUserGroups(phone) {
        await this.updateCache();

        const formattedPhone = this._formatPhone(phone);
        const groupIds = this.userGroupsIndex.get(formattedPhone);

        if (!groupIds) return [];

        return Array.from(groupIds).map(groupId => {
            const group = this.groupsCache.get(groupId);
            return {
                phone: group.id, // O phone é o ID do grupo na Z-API
                name: group.name
            };
        });
    }

    /**
     * Retorna a lista completa de grupos no cache (para uso de Admin sem número de WhatsApp).
     * @returns {Array<object>} Lista de todos os grupos em cache.
     */
    async getAllGroupsFromCache() {
        await this.updateCache();
        return Array.from(this.groupsCache.values()).map(group => ({
            phone: group.id,
            name: group.name
        }));
    }

    /**
     * Inicia o worker que atualiza o cache a cada 5 minutos.
     */
    startCacheWorker() {
        // Roda a primeira vez imediatamente
        this.updateCache().catch(err => logger.error("Falha inicial ao carregar cache de grupos.", err)); 
        // Roda a cada 5 minutos
        setInterval(() => this.updateCache().catch(err => logger.error("Worker falhou ao atualizar cache.", err)), this.CACHE_DURATION);
    }
}

module.exports = new GroupManagerService();