const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const express = require('express');
const yts = require('yt-search');
const path = require('path');
const fs = require('fs');

const app = express();
let qrCodeData = null;
let isReady = false;

app.get('/', (req, res) => {
    if (isReady) res.send('<h1 style="font-family:sans-serif;text-align:center;margin-top:50px">✅ BOT CONECTADO Y ACTIVO</h1>');
    else if (qrCodeData) {
        qrcode.toDataURL(qrCodeData, (err, url) => {
            if (err) return res.send('Error');
            res.send(`<div style="text-align:center;margin-top:20px;font-family:sans-serif"><h2>Escanea QR</h2><img src="${url}" style="width:300px"><br><p>Se actualiza cada 15s</p><script>setTimeout(()=>location.reload(),15000)</script></div>`);
        });
    } else res.send('<h1 style="font-family:sans-serif;text-align:center;margin-top:50px">Iniciando... recarga en 20s</h1>');
});
app.listen(process.env.PORT || 10000, () => console.log('WEB OK'));

const client = new Client({
    authStrategy: new LocalAuth({ dataPath: './.wwebjs_auth' }),
    puppeteer: { headless: true, args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--single-process','--no-zygote'] }
});

client.on('qr', (qr) => { console.log('QR RECIBIDO'); qrCodeData = qr; });
client.on('ready', () => { console.log('BOT LISTO'); isReady = true; qrCodeData = null; });

// ESTE ES EL FIX: message_create SI escucha cuando te hablas a ti mismo
client.on('message_create', async msg => {
    try {
        const body = msg.body || '';
        console.log('Mensaje recibido:', body, 'fromMe:', msg.fromMe, 'from:', msg.from);
        if (!body.toLowerCase().startsWith('!play')) return;
        if (msg.from.endsWith('@g.us')) return; // ignora grupos

        let query = body.slice(5).trim(); // quita !play
        if (!query) {
            return await msg.reply('Escribe: !play nombre de cancion\nEj: !play bad bunny');
        }

        const r = await yts(query);
        const video = r.videos[0];
        if (!video) return await msg.reply('No encontré esa canción');
        
        await msg.reply(`*${video.title}*\n${video.url}\n\n_Duración: ${video.timestamp}_`);
    } catch(e) {
        console.log('Error en !play:', e.message);
    }
});

client.initialize();
