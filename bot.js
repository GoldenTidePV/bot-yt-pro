const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, jidNormalizedUser } = require('@whiskeysockets/baileys');
const express = require('express');
const QRCode = require('qrcode');
const pino = require('pino');
const fs = require('fs');
const path = require('path');
const http = require('https');

const app = express();
let lastQR = null;
let lastSearch = {};
const SESSION_FILE = './auth_session';

if (!fs.existsSync(SESSION_FILE)) fs.mkdirSync(SESSION_FILE, { recursive: true });

app.get('/ping', (req, res) => res.send('ok'));
app.get('/', async (req, res) => {
  if (process.env.WA_SESSION_DATA) return res.send('<h1>BOT CONECTADO VÍA VARIABLES DE ENTORNO</h1>');
  if (!lastQR) return res.send('<h1>BOT CONECTADO</h1>');
  const img = await QRCode.toDataURL(lastQR);
  res.send(`<h1>Escanea el QR</h1><img src="${img}" style="width:350px">`);
});
app.listen(process.env.PORT || 10000, () => console.log('Servidor listo'));

async function start() {
  const { state, saveCreds } = await useMultiFileAuthState(SESSION_FILE);

  if (process.env.WA_SESSION_DATA && !fs.existsSync(`${SESSION_FILE}/creds.json`)) {
    try {
      const decryptedCreds = Buffer.from(process.env.WA_SESSION_DATA, 'base64').toString('utf-8');
      fs.writeFileSync(`${SESSION_FILE}/creds.json`, decryptedCreds);
      console.log('=> Sesión importada exitosamente.');
    } catch (e) {
      console.log('Error cargando sesión:', e);
    }
  }

  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: true,
    logger: pino({ level: 'silent' }),
    broadcastPosition: false
  });

  sock.ev.on('creds.update', async () => {
    await saveCreds();
    if (fs.existsSync(`${SESSION_FILE}/creds.json`)) {
      const credsRaw = fs.readFileSync(`${SESSION_FILE}/creds.json`, 'utf-8');
      const base64Session = Buffer.from(credsRaw).toString('base64');
      console.log('\n======================================\n👉 TU CÓDIGO DE SESIÓN PERSISTENTE:\n' + base64Session + '\n======================================\n');
    }
  });

  sock.ev.on('connection.update', (u) => {
    const { connection, lastDisconnect, qr } = u;
    if (qr) lastQR = qr;
    if (connection === 'open') { lastQR = null; console.log('🚀 ¡BOT WHATSAPP CONECTADO!'); }
    if (connection === 'close') {
      const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
      if (shouldReconnect) start();
    }
  });

  // CORRECCIÓN FINAL: Captura de mensajes entrantes y salientes (tuyos) mapeados al identificador correcto
  sock.ev.on('messages.upsert', async (chatUpdate) => {
    try {
      if (!chatUpdate.messages || chatUpdate.messages.length === 0) return;
      const m = chatUpdate.messages[0]; 
      if (!m.message) return;

      const myJid = jidNormalizedUser(sock.user.id);
      const remoteJid = m.key.remoteJid;
      
      if (remoteJid.endsWith('@g.us') || remoteJid === 'status@broadcast') return;

      // Forzar que si el mensaje es de uno mismo, el bot responda al canal personal de notas
      const targetJid = (m.key.fromMe || remoteJid === 'me' || remoteJid === myJid) ? myJid : remoteJid;

      const txt = m.message.conversation || m.message.extendedTextMessage?.text || '';
      if (!txt) return;
      const t = txt.trim().toLowerCase();

      if (['cancelar', 'c', '0'].includes(t)) {
        delete lastSearch[targetJid];
        await sock.sendMessage(targetJid, { text: '❌ Búsqueda cancelada.' });
        return;
      }

      const args = t.split(/\s+/);
      const num = parseInt(args[0]);

      // Procesar descargas mediante API
      if (!isNaN(num) && num >= 1 && num <= 3 && lastSearch[targetJid]) {
        let format = args[1] || 'mp3';
        if (format === 'audio') format = 'mp3';
        if (format === 'video') format = 'mp4';

        const v = lastSearch[targetJid][num - 1];
        delete lastSearch[targetJid]; 

        await sock.sendMessage(targetJid, { text: `📥 Descargando *${format.toUpperCase()}* de:\n_${v.title}_\n\nPor favor, espera un momento... ⏳` });

        const apiDownloadUrl = `https://workers.dev{format}?url=${encodeURIComponent(v.url)}`;
        const tempFile = path.join(__dirname, `${Date.now()}.${format}`);
        const fileStream = fs.createWriteStream(tempFile);

        http.get(apiDownloadUrl, (response) => {
          response.pipe(fileStream);
          fileStream.on('finish', async () => {
            try {
              if (format === 'mp3') {
                await sock.sendMessage(targetJid, { audio: { url: tempFile }, mimetype: 'audio/mp4', fileName: `${v.title}.mp3` });
              } else {
                await sock.sendMessage(targetJid, { video: { url: tempFile }, caption: `🎬 *${v.title}*`, mimetype: 'video/mp4' });
              }
            } catch (err) {
              await sock.sendMessage(targetJid, { text: '❌ Error al subir el archivo multimedia al chat.' });
            } finally {
              if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
            }
          });
        }).on('error', async () => {
          await sock.sendMessage(targetJid, { text: '❌ Falló la conexión con el servidor de descargas.' });
          if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
        });
        return;
      }

      // Proceso de búsqueda
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
              let msg = `🎵 *Resultados de YouTube:*\n\n`;
              let count = 0;

              while ((match = regex.exec(data)) !== null && count < 3) {
                const id = match[1];
                const title = match[2];
                results.push({ title, url: `https://youtube.com{id}` });
                msg += `*${count + 1}.* ${title}\n\n`;
                count++;
              }

              if (results.length === 0) return;

              lastSearch[targetJid] = results;
              msg += `👉 Responde con el número y formato.\nEjemplos:\n*1 mp3* (Para audio)\n*1 mp4* (Para video)`;
              await sock.sendMessage(targetJid, { text: msg });
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
}
start();
