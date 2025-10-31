# --- Estágio 1: Construção da Aplicação ---
# Usamos um espelho alternativo do Node.js (mirror.gcr.io) para evitar limite de pull do Docker Hub.
FROM mirror.gcr.io/library/node:18-slim AS base

# Define o diretório de trabalho dentro do contêiner.
WORKDIR /app

# --- INÍCIO DA CORREÇÃO ---
# Instala as dependências do sistema operacional.
# - 'apt-get update' atualiza a lista de pacotes.
# - 'apt-get install -y poppler-utils' instala o Poppler sem pedir confirmação.
# - '--no-install-recommends' evita pacotes desnecessários.
# - 'rm -rf /var/lib/apt/lists/*' limpa o cache para manter a imagem final leve.
RUN apt-get update && \
    apt-get install -y poppler-utils --no-install-recommends && \
    rm -rf /var/lib/apt/lists/*
# --- FIM DA CORREÇÃO ---

# Copia primeiro o package.json e package-lock.json.
# Isso aproveita o cache do Docker — se esses arquivos não mudarem,
# o Docker não reinstala as dependências.
COPY package*.json ./

# Instala as dependências do Node.js.
RUN npm install --omit=dev

# Copia todo o resto do código da aplicação.
COPY . .

# --- Estágio 2: Execução ---
# Expõe a porta que a aplicação utiliza (ajuste se necessário).
EXPOSE 3000

# Define variáveis de ambiente úteis (ajustáveis conforme o ambiente).
ENV NODE_ENV=production

# Define o comando padrão ao iniciar o contêiner.
CMD ["node", "src/app.js"]