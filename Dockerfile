# --- Estágio 1: Construção da Aplicação ---
# Usamos a imagem oficial do Node.js v18. É uma base sólida e comum.
FROM node:18-slim AS base

# Define o diretório de trabalho dentro do contêiner.
WORKDIR /app

# Instala as dependências do sistema.
# - 'apt-get update' atualiza a lista de pacotes.
# - 'apt-get install -y poppler-utils' instala o Poppler sem pedir confirmação.
# - '--no-install-recommends' evita instalar pacotes desnecessários.
# - 'rm -rf /var/lib/apt/lists/*' limpa o cache para manter a imagem final pequena.
RUN apt-get update && \
    apt-get install -y --no-install-recommends poppler-utils && \
    rm -rf /var/lib/apt/lists/*

# Copia primeiro o package.json e package-lock.json.
# Isso aproveita o cache do Docker. Se esses arquivos não mudarem,
# o Docker não vai reinstalar as dependências toda vez, acelerando o build.
COPY package*.json ./

# Instala as dependências do Node.js.
RUN npm install

# Copia todo o resto do código da sua aplicação para o diretório de trabalho.
COPY . .

# --- Estágio 2: Imagem Final ---
# Expõe a porta que sua aplicação usa (você mencionou 3000 nos logs).
# O Easypanel gerencia isso, mas é uma boa prática documentar.
EXPOSE 3000

# Define o comando que será executado quando o contêiner iniciar.
# Usamos a forma exec `["node", "src/app.js"]` que é mais eficiente que "npm start".
CMD ["node", "src/app.js"]