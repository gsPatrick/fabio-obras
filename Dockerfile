# Use uma imagem base oficial do Node.js
FROM node:18-slim

# Instala o poppler-utils e outras dependências comuns
# A flag --no-install-recommends mantém a imagem pequena
RUN apt-get update && apt-get install -y --no-install-recommends poppler-utils

# Define o diretório de trabalho dentro do contêiner
WORKDIR /app

# Copia os arquivos de dependência e instala
COPY package*.json ./
RUN npm install

# Copia o resto do código da sua aplicação
COPY . .

# Expõe a porta que sua aplicação usa
EXPOSE 5000

# Comando para iniciar sua aplicação
CMD ["node", "src/app.js"] 