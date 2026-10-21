const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const express = require('express');
const QRCode = require('qrcode');
const fs = require('fs');
const path = require('path');
const http = require('https');

const app = express();
let lastQR = null;
let lastSearch = {};

app.get('/ping', (req, res) => res.send('ok'));
app.get('/', async (req, res) => {
  if (!lastQR) return res.send('<h1>BOT CONECTADO</h1><p>Tu bot ya está activo y escuchando tu chat propio.</p>');
  const img = await QRCode.toDataURL(lastQR);
  res.send(`<h1>Escanea el QR</h1><img src="${img}" style="width:350px">`);
});
app.listen(process.env.PORT || 10000, () => console.log('Servidor web listo'));

// Inicializar el cliente que emula el navegador nativo
const client = new Client({
    authStrategy: new LocalAuth({ dataPath: './auth_session' }),
    puppeteer: {
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    }
});

client.on('qr', (qr) => {
    lastQR = qr;
    console.log('Nuevo código QR generado. Por favor, escanéalo en la web.');
});

client.on('ready', () => {
    lastQR = null;
    console.log('🚀 ¡BOT TOTALMENTE CONECTADO A TU PROPIO NÚMERO!');
});

// EVENTO CLAVE: Escucha absolutamente todos los mensajes creados, incluidos los tuyos
client.on('message_create', async (msg) => {
    try {
        // Ignorar chats de grupos
        if (msg.from.endsWith('@g.us') || msg.to.endsWith('@g.us')) return;

        const chat = await msg.getChat();
        const jid = chat.id._serialized;
        const txt = msg.body ? msg.body.trim() : '';
        if (!txt) return;
        const t = txt.toLowerCase();

        if (['cancelar', 'c', '0'].includes(t)) {
            delete lastSearch[jid];
            await client.sendMessage(jid, '❌ Búsqueda cancelada.');
            return;
        }

        const args = t.split(/\s+/);
        const num = parseInt(args[0]);

        // Procesar selección numérica para descargas
        if (!isNaN(num) && num >= 1 && num <= 3 && lastSearch[jid]) {
            let format = args[1] || 'mp3';
            if (format === 'audio') format = 'mp3';
            if (format === 'video') format = 'mp4';

            const v = lastSearch[jid][num - 1];
            delete lastSearch[jid];

            await client.sendMessage(jid, `📥 Descargando *${format.toUpperCase()}* de:\n_${v.title}_\n\nEspera un momento... ⏳`);

            const apiDownloadUrl = `https://workers.dev{format}?url=${encodeURIComponent(v.url)}`;
            const tempFile = path.join(__dirname, `${Date.now()}.${format}`);
            const fileStream = fs.createWriteStream(tempFile);

            http.get(apiDownloadUrl, (response) => {
                response.pipe(fileStream);
                fileStream.on('finish', async () => {
                    try {
                        const media = MessageMedia.fromFilePath(tempFile);
                        if (format === 'mp3') {
                            await client.sendMessage(jid, media, { sendAudioAsVoice: false });
                        } else {
                            await client.sendMessage(jid, media, { caption: `🎬 *${v.title}*` });
                        }
                    } catch (err) {
                        await client.sendMessage(jid, '❌ Error al subir el archivo multimedia al chat.');
                    } finally {
                        if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
                    }
                });
            }).on('error', async () => {
                await client.sendMessage(jid, '❌ Falló la conexión con el servidor de descargas.');
                if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
            });
            return;
        }

        // Búsqueda en YouTube mediante raspado nativo directo
        if (isNaN(num) && t.length > 2) {
            const searchUrl = `https://youtube.com{encodeURIComponent(txt)}`;
            
            http.get(searchUrl, (res) => {
                let data = '';
                res.on('data', (chunk) => data += chunk);
                res.on('end', async () => {
                    try {
                        const regex = /"videoRenderer":{"videoId":"([^"]+)","title":{"runs":\[{"text":"([^"]+)"\}\]/g;
                        const results = [];
                        let match;
                        let responseMsg = `🎵 *Resultados de YouTube:*\n\n`;
                        let count = 0;

                        while ((match = regex.exec(data)) !== null && count < 3) {
                            results.push({ title: match[2], url: `https://youtube.com{match[1]}` });
                            responseMsg += `*${count + 1}.* ${match[2]}\n\n`;
                            count++;
                        }

                        if (results.length === 0) return;

                        lastSearch[jid] = results;
                        responseMsg += `👉 Responde con el número y formato.\nEjemplos:\n*1 mp3* (Para audio)\n*1 mp4* (Para video)`;
                        await client.sendMessage(jid, responseMsg);
                    } catch (e) {
                        console.error(e);
                    }
                });
            });
        }
    } catch (err) {
        console.error(err);
    }
});

client.initialize();
