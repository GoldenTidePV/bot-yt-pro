FROM node:20-slim
WORKDIR /app
COPY package*.json ./
RUN npm install
RUN npx puppeteer browsers install chrome --with-deps
COPY . .
ENV PORT=10000
EXPOSE 10000
CMD ["node", "bot.js"]
