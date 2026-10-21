const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, jidNormalizedUser } = require('@whiskeysockets/baileys');
const express = require('express');
const QRCode = require('qrcode');
const pino = require('pino');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

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

  async function handleMessage(m) {
    try {
      if (!m.message) return;

      const myJid = jidNormalizedUser(sock.user.id);
      const remoteJid = m.key.remoteJid;
      
      if (remoteJid.endsWith('@g.us') || remoteJid === 'status@broadcast') return;

      // El destino siempre será tu propio chat si interactúas contigo mismo
      const targetJid = (remoteJid === 'me' || m.key.fromMe) ? myJid : remoteJid;

      const txt = m.message.conversation || m.message.extendedTextMessage?.text || '';
      if (!txt) return;
      const t = txt.trim().toLowerCase();

      if (['cancelar', 'c', '0'].includes(t)) {
        delete lastSearch[targetJid];
        await sock.sendMessage(targetJid, { text: '❌ Búsqueda cancelada.' });
        return;
      }

      // Analizar comandos (Ej: "1 mp3", "2 mp4")
      const args = t.split(/\s+/);
      const num = parseInt(args[0]);

      if (!isNaN(num) && num >= 1 && num <= 3 && lastSearch[targetJid]) {
        let format = args[1] || 'mp3';
        if (format === 'audio') format = 'mp3';
        if (format === 'video') format = 'mp4';

        const v = lastSearch[targetJid][num - 1];
        delete lastSearch[targetJid]; 

        await sock.sendMessage(targetJid, { text: `📥 Descargando *${format.toUpperCase()}* de:\n_${v.title}_\n\nEsto puede tomar un minuto... ⏳` });

        const tempFile = path.join(__dirname, `${Date.now()}.${format}`);
        let command = format === 'mp3' 
          ? `yt-dlp -f bestaudio --extract-audio --audio-format mp3 -o "${tempFile}" "${v.url}"`
          : `yt-dlp -f "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best" -o "${tempFile}" "${v.url}"`;

        exec(command, async (error) => {
          if (error) {
            await sock.sendMessage(targetJid, { text: '❌ Falló la descarga multimedia con yt-dlp.' });
            return;
          }

          try {
            if (format === 'mp3') {
              await sock.sendMessage(targetJid, { audio: { url: tempFile }, mimetype: 'audio/mp4', fileName: `${v.title}.mp3` });
            } else {
              await sock.sendMessage(targetJid, { video: { url: tempFile }, caption: `🎬 *${v.title}*`, mimetype: 'video/mp4' });
            }
          } catch (err) {
            await sock.sendMessage(targetJid, { text: '❌ Error al subir el archivo al chat.' });
          } finally {
            if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
          }
        });
        return;
      }

      // Búsqueda en YouTube usando la herramienta yt-dlp nativa del sistema
      if (isNaN(num) && t.length > 2) {
        const searchQuery = txt.replace(/"/g, '\\"');
        const searchCmd = `yt-dlp "ytsearch3:${searchQuery}" --dump-json --flat-playlist`;

        exec(searchCmd, async (error, stdout) => {
          if (error || !stdout) return;

          try {
            const lines = stdout.trim().split('\n');
            const results = [];
            let msg = `🎵 *Resultados de YouTube encontrados: * \n\n`;

            for (let i = 0; i < lines.length; i++) {
              if (!lines[i]) continue;
              const videoData = JSON.parse(lines[i]);
              results.push({
                title: videoData.title,
                url: `https://youtube.com{videoData.id}`
              });
              msg += `*${i + 1}. * ${videoData.title}\n\n`;
            }

            lastSearch[targetJid] = results;
            msg += `👉 Responde con el número y formato.\nEjemplos:\n*1 mp3* (Para audio)\n*1 mp4* (Para video)`;

            await sock.sendMessage(targetJid, { text: msg });
          } catch (e) {
            console.error(e);
          }
        });
      }
    } catch (err) {
      console.error(err);
    }
  }

  sock.ev.on('messages.upsert', async (chatUpdate) => {
    if (chatUpdate.messages && chatUpdate.messages.length > 0) {
      await handleMessage(chatUpdate.messages[0]);
    }
  });

  sock.ev.on('messages.update', async (chatUpdate) => {
    if (chatUpdate && chatUpdate.length > 0) {
      await handleMessage(chatUpdate[0]);
    }
  });
}
start();
