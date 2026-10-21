FROM node:20

# Instalamos python3, ffmpeg y descargamos la herramienta oficial yt-dlp
RUN apt-get update && apt-get install -y python3 python3-pip ffmpeg wget && \
    wget https://github.com -O /usr/local/bin/yt-dlp && \
    chmod a+rx /usr/local/bin/yt-dlp && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

EXPOSE 10000

CMD ["node", "bot.js"]
