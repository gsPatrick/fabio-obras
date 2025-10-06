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
        
        this.startCacheWorker();
    }
    
    /**
     * <<< CORREÇÃO: Normaliza o número de telefone para o formato brasileiro com DDI.
     * Remove caracteres não numéricos e garante que o DDI '55' esteja presente.
     */
    _formatPhone(phone) {
        if (!phone) return '';
        const cleanedPhone = phone.replace(/[^0-9]/g, '');

        // Se o número não começa com 55 e tem o tamanho de um número brasileiro comum (com ou sem o 9º dígito),
        // adiciona o DDI do Brasil. Isso resolve a inconsistência da Z-API.
        if (!cleanedPhone.startsWith('55') && (cleanedPhone.length === 10 || cleanedPhone.length === 11)) {
            return `55${cleanedPhone}`;
        }
        
        return cleanedPhone;
    }

    /**
     * Atualiza o cache de grupos e o índice de usuários.
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
            const listResponse = await axios.get(`${BASE_URL}/groups`, { headers });
            const groups = (listResponse.data || []).filter(chat => chat.isGroup);

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
                        // A normalização acontece aqui, garantindo que o índice seja consistente
                        const phone = this._formatPhone(participant.phone); 
                        if (!this.userGroupsIndex.has(phone)) {
                            this.userGroupsIndex.set(phone, new Set());
                        }
                        this.userGroupsIndex.get(phone).add(group.phone);
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
     */
    async findUserGroups(phone) {
        await this.updateCache();

        // Garante que o número pesquisado também seja normalizado
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

    /**
     * Retorna a lista completa de grupos no cache.
     */
    async getAllGroupsFromCache() {
        await this.updateCache();
        return Array.from(this.groupsCache.values()).map(group => ({
            phone: group.id,
            name: group.name
        }));
    }

    /**
     * Inicia o worker que atualiza o cache.
     */
    startCacheWorker() {
        this.updateCache().catch(err => logger.error("Falha inicial ao carregar cache de grupos.", err)); 
        setInterval(() => this.updateCache().catch(err => logger.error("Worker falhou ao atualizar cache.", err)), this.CACHE_DURATION);
    }
}

module.exports = new GroupManagerService();