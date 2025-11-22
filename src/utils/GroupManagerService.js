// src/services/GroupManagerService.js
const axios = require('axios');
const logger = require('../utils/logger');
const fs = require('fs');
const path = require('path');
const { ZAPI_INSTANCE_ID, ZAPI_TOKEN, ZAPI_CLIENT_TOKEN } = process.env;

const BASE_URL = `https://api.z-api.io/instances/${ZAPI_INSTANCE_ID}/token/${ZAPI_TOKEN}`;
const headers = { 'Content-Type': 'application/json', 'client-token': ZAPI_CLIENT_TOKEN };

// Arquivo onde o cache será salvo para sobreviver ao reinício
const CACHE_FILE_PATH = path.join(__dirname, '../../cache_groups.json');

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

class GroupManagerService {
    constructor() {
        this.groupsCache = new Map();
        this.userGroupsIndex = new Map();
        this.lastUpdate = null;
        this.CACHE_DURATION = 10 * 60 * 1000; // Aumentei para 10 min para evitar spam na Z-API
        
        // 1. Tenta carregar do disco imediatamente ao iniciar
        this.loadCacheFromDisk();
        
        // 2. Inicia o worker para atualizar dados novos em background
        this.startCacheWorker();
    }
    
    _formatPhone(phone) {
        if (!phone) return '';
        const cleanedPhone = phone.replace(/[^0-9]/g, '');
        // Lógica básica para padronizar 55...
        if (!cleanedPhone.startsWith('55') && (cleanedPhone.length === 10 || cleanedPhone.length === 11)) {
            return `55${cleanedPhone}`;
        }
        return cleanedPhone;
    }

    // <<< SALVAR EM DISCO >>>
    saveCacheToDisk() {
        try {
            const dataToSave = {
                timestamp: Date.now(),
                groups: Array.from(this.groupsCache.entries()),
                userIndex: Array.from(this.userGroupsIndex.entries()).map(([k, v]) => [k, Array.from(v)]) // Converte Set para Array
            };
            fs.writeFileSync(CACHE_FILE_PATH, JSON.stringify(dataToSave));
            logger.info('💾 [GroupManager] Cache de grupos salvo no disco com sucesso.');
        } catch (error) {
            logger.error('❌ [GroupManager] Erro ao salvar cache em disco:', error.message);
        }
    }

    // <<< CARREGAR DO DISCO >>>
    loadCacheFromDisk() {
        try {
            if (fs.existsSync(CACHE_FILE_PATH)) {
                const rawData = fs.readFileSync(CACHE_FILE_PATH);
                const parsedData = JSON.parse(rawData);
                
                this.groupsCache = new Map(parsedData.groups);
                
                // Reconstrói o índice de usuários (convertendo Array de volta para Set)
                this.userGroupsIndex = new Map();
                parsedData.userIndex.forEach(([phone, groupArray]) => {
                    this.userGroupsIndex.set(phone, new Set(groupArray));
                });

                this.lastUpdate = parsedData.timestamp;
                logger.info(`📂 [GroupManager] Cache carregado do disco. ${this.groupsCache.size} grupos restaurados.`);
            } else {
                logger.info('📂 [GroupManager] Nenhum cache em disco encontrado. Iniciando vazio.');
            }
        } catch (error) {
            logger.error('❌ [GroupManager] Erro ao carregar cache do disco (arquivo pode estar corrompido):', error.message);
        }
    }

    async updateCache() {
        // Se já temos dados e ainda não passou o tempo de expiração, não faz nada
        if (this.lastUpdate && (Date.now() - this.lastUpdate) < this.CACHE_DURATION) {
            return;
        }

        logger.info('⚙️ [CacheWorker] Iniciando atualização de cache de grupos na Z-API...');
        
        // Usamos mapas temporários para não limpar o cache atual enquanto buscamos (evita "piscar" vazio para o usuário)
        const tempGroupsCache = new Map();
        const tempUserGroupsIndex = new Map();
        let groupsFetched = 0;

        try {
            const params = { pageSize: 500 };
            const listResponse = await axios.get(`${BASE_URL}/groups`, { headers, params });
            const groups = listResponse.data || [];

            logger.info(`[CacheWorker] ${groups.length} grupos encontrados na API. Atualizando detalhes...`);
            
            for (const group of groups) {
                try {
                    // Salvamos o básico do grupo
                    tempGroupsCache.set(group.phone, { id: group.phone, name: group.name });

                    // Tenta pegar participantes
                    const groupMetadata = await axios.get(
                        `${BASE_URL}/group-metadata/${group.phone}`,
                        { headers }
                    );
                    
                    const participants = groupMetadata.data.participants || [];
                    
                    participants.forEach(participant => {
                        const phone = this._formatPhone(participant.phone); 
                        if (phone) {
                            if (!tempUserGroupsIndex.has(phone)) {
                                tempUserGroupsIndex.set(phone, new Set());
                            }
                            tempUserGroupsIndex.get(phone).add(group.phone);
                        }
                    });
                    groupsFetched++;
                } catch (error) {
                    // Se falhar ao pegar detalhes, mantemos o grupo na lista pelo menos com o nome
                    // Isso evita que o grupo suma da lista se a Z-API der timeout nos metadados
                    if (!tempGroupsCache.has(group.phone)) {
                         tempGroupsCache.set(group.phone, { id: group.phone, name: group.name });
                    }
                    // logger.warn(`[CacheWorker] Falha leve ao detalhar grupo ${group.phone}. Mantendo dados básicos.`);
                }
                
                // Pequeno delay para não estourar rate limit
                await delay(200); 
            }

            // Atualiza o cache principal com os novos dados
            this.groupsCache = tempGroupsCache;
            this.userGroupsIndex = tempUserGroupsIndex;
            this.lastUpdate = Date.now();
            
            // SALVA NO DISCO AGORA
            this.saveCacheToDisk();

            logger.info(`✅ [CacheWorker] Cache atualizado e salvo. ${groupsFetched} grupos processados.`);
        } catch (error) {
            logger.error('[CacheWorker] Erro crítico ao buscar lista de grupos:', error.message);
        }
    }

    async findUserGroups(phone) {
        // Se cache vazio (primeira vez e sem disco), tenta atualizar
        if (this.groupsCache.size === 0) {
            logger.warn('[GroupManager] Cache vazio, forçando atualização...');
            await this.updateCache();
        }

        const formattedPhone = this._formatPhone(phone);
        const groupIds = this.userGroupsIndex.get(formattedPhone);

        if (!groupIds) return [];

        return Array.from(groupIds).map(groupId => {
            const group = this.groupsCache.get(groupId);
            // Proteção caso o grupo esteja no índice mas não no mapa (raro)
            if (!group) return { phone: groupId, name: 'Grupo Desconhecido' };
            return { phone: group.id, name: group.name };
        });
    }

    async getAllGroupsFromCache() {
        if (this.groupsCache.size === 0) {
             await this.updateCache();
        }
        return Array.from(this.groupsCache.values()).map(group => ({
            phone: group.id,
            name: group.name
        }));
    }

    startCacheWorker() {
        // Executa a primeira atualização sem travar o boot (se já carregou do disco, ótimo)
        this.updateCache().catch(err => logger.error("Falha inicial ao atualizar cache.", err)); 
        
        // Repete a cada X minutos
        setInterval(() => this.updateCache().catch(err => logger.error("Worker falhou ao atualizar cache.", err)), this.CACHE_DURATION);
    }
}

module.exports = new GroupManagerService();