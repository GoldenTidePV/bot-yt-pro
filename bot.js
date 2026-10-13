const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const express = require('express');
const yts = require('yt-search');
const fs = require('fs');
const puppeteer = require('puppeteer');

const app = express();
const PORT = process.env.PORT || 10000;
let qrCodeData = null;
let isReady = false;

app.get('/', (req, res) => {
    if (isReady) {
        res.send('<h1 style="font-family:sans-serif;text-align:center;margin-top:50px">✅ BOT CONECTADO Y LISTO</h1>');
    } else if (qrCodeData) {
        qrcode.toDataURL(qrCodeData, (err, url) => {
            if (err) return res.send('Error generando QR');
            res.send(`<div style="text-align:center;margin-top:20px;font-family:sans-serif"><h2>Escanea este QR en WhatsApp</h2><img src="${url}" style="width:300px"><p>Bot: ${new Date().toLocaleString()}</p><script>setTimeout(()=>location.reload(),15000)</script></div>`);
        });
    } else {
        res.send('<h1 style="font-family:sans-serif;text-align:center;margin-top:50px">Iniciando bot... espera 30 seg y recarga</h1>');
    }
});

app.get('/ping', (req, res) => res.send('pong'));
app.listen(PORT, () => console.log('WEB en puerto ' + PORT));

console.log('Iniciando cliente de WhatsApp...');
console.log('Chrome path:', puppeteer.executablePath());

const client = new Client({
    authStrategy: new LocalAuth({
        dataPath: './.wwebjs_auth'
    }),
    puppeteer: {
        headless: true,
        executablePath: puppeteer.executablePath(),
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--single-process',
            '--disable-gpu'
        ]
    }
});

client.on('qr', (qr) => {
    console.log('QR RECIBIDO - Ve a tu link de Render para escanearlo');
    qrCodeData = qr;
});

client.on('ready', () => {
    console.log('¡BOT LISTO Y CONECTADO!');
    isReady = true;
    qrCodeData = null;
});

client.on('authenticated', () => {
    console.log('AUTENTICADO');
});

client.on('auth_failure', (m) => {
    console.log('FALLO AUTH:', m);
});

client.on('disconnected', (reason) => {
    console.log('Desconectado:', reason);
    isReady = false;
});

client.on('message', async msg => {
    if (msg.from.endsWith('@g.us')) return; // ignora grupos si quieres, borra esta linea si quieres grupos
    const body = msg.body || '';
    if (!body.toLowerCase().startsWith('!play ')) return;

    const query = body.slice(6).trim();
    if (!query) return msg.reply('Escribe !play nombre de cancion');

    try {
        msg.reply(`🔍 Buscando: *${query}*...`);
        const r = await yts(query);
        if (!r.videos.length) return msg.reply('No encontré nada');
        const video = r.videos[0];
        await msg.reply(`*${video.title}*\nDuración: ${video.timestamp}\n${video.url}\n\n_Esta función de descarga está en proceso, por ahora solo búsqueda._`);
    } catch (e) {
        console.log('Error !play:', e.message);
        msg.reply('Error buscando la canción');
    }
});

client.initialize().catch(err => {
    console.log('Error initialize:', err);
});
