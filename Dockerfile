FROM node:20-slim

RUN apt-get update && apt-get install -y chromium ffmpeg python3 python3-pip curl && rm -rf /var/lib/apt/lists/* && pip3 install yt-dlp --break-system-packages

WORKDIR /app

COPY package.json ./
RUN npm install

COPY . .

ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV NODE_ENV=production

EXPOSE 10000

CMD ["node", "bot.js"]
