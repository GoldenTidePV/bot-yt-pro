FROM node:20

# Instalamos ffmpeg completo para asegurar compatibilidad de audio/video
RUN apt-get update && apt-get install -y ffmpeg && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

EXPOSE 10000

CMD ["node", "bot.js"]
