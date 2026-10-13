FROM node:20-slim

# Instala Chrome y dependencias
RUN apt-get update && apt-get install -y \
    wget gnupg ca-certificates \
    && npx -y puppeteer browsers install chrome --with-deps \
    && apt-get clean

WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .

ENV PORT=10000
EXPOSE 10000
CMD ["node", "bot.js"]
