const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const express = require('express');
const yts = require('yt-search');
const QRCode = require('qrcode');
const ytdl = require('@distube/ytdl-core');
const pino = require('pino');
const fs = require('fs');
const path = require('path');

const app = express();
let lastQR = null;
let lastSearch = {};
const SESSION_FILE = './auth_session';

if (!fs.existsSync(SESSION_FILE)) fs.mkdirSync(SESSION_FILE, { recursive: true });

app.get('/ping', (req, res) => res.send('ok'));
app.get('/', async (req, res) => {
  if (process.env.WA_SESSION_DATA) return res.send('<h1>BOT CONECTADO VÍA VARIABLES DE ENTORNO</h1><p>Tu sesión ya está guardada.</p>');
  if (!lastQR) return res.send('<h1>BOT CONECTADO</h1>');
  const img = await QRCode.toDataURL(lastQR);
  res.send(`<h1>Escanea este QR</h1><img src="${img}" style="width:350px">`);
});
app.listen(process.env.PORT || 10000, () => console.log('Servidor listo'));

async function start() {
  const { state, saveCreds } = await useMultiFileAuthState(SESSION_FILE);

  if (process.env.WA_SESSION_DATA && !fs.existsSync(`${SESSION_FILE}/creds.json`)) {
    try {
      const decryptedCreds = Buffer.from(process.env.WA_SESSION_DATA, 'base64').toString('utf-8');
      fs.writeFileSync(`${SESSION_FILE}/creds.json`, decryptedCreds);
      console.log('=> Sesión importada exitosamente desde variables de entorno.');
    } catch (e) {
      console.log('Error cargando sesión persistente:', e);
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

  sock.ev.on('messages.upsert', async (chatUpdate) => {
    try {
      if (!chatUpdate.messages || chatUpdate.messages.length === 0) return;
      const m = chatUpdate.messages[0]; // Captura explícita del primer mensaje del array
      if (!m.message) return;

      const jid = m.key.remoteJid;
      if (jid.endsWith('@g.us') || jid === 'status@broadcast') return;

      const txt = m.message.conversation || m.message.extendedTextMessage?.text || '';
      if (!txt) return;
      const t = txt.trim().toLowerCase();

      if (['cancelar', 'c', '0'].includes(t)) {
        delete lastSearch[jid];
        await sock.sendMessage(jid, { text: '❌ Búsqueda cancelada.' });
        return;
      }

      // CORRECCIÓN: Filtro simplificado de coincidencia numérica de selección
      const args = t.split(' ');
      const num = parseInt(args[0]);

      if (!isNaN(num) && num >= 1 && num <= 3 && lastSearch[jid]) {
        let format = args[1] || 'mp3';
        if (format === 'audio') format = 'mp3';
        if (format === 'video') format = 'mp4';

        const v = lastSearch[jid][num - 1];
        delete lastSearch[jid]; 

        await sock.sendMessage(jid, { text: `📥 Procesando descarga *${format.toUpperCase()}* de:\n_${v.title}_\n\nEspera un momento... ⏳` });

        const tempFile = path.join(__dirname, `${Date.now()}.${format}`);
        const options = format === 'mp3' ? { filter: 'audioonly', quality: 'highestaudio' } : { format: 'mp4', quality: 'highest' };
        
        const stream = ytdl(v.url, options);
        const fileStream = fs.createWriteStream(tempFile);

        stream.pipe(fileStream);

        fileStream.on('finish', async () => {
          try {
            if (format === 'mp3') {
              await sock.sendMessage(jid, { 
                audio: { url: tempFile }, 
                mimetype: 'audio/mp4', 
                fileName: `${v.title}.mp3` 
              });
            } else {
              await sock.sendMessage(jid, { 
                video: { url: tempFile }, 
                caption: `🎬 *${v.title}* listo.`,
                mimetype: 'video/mp4' 
              });
            }
          } catch (err) {
            await sock.sendMessage(jid, { text: '❌ Error al enviar el archivo multimedia.' });
          } finally {
            if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
          }
        });

        stream.on('error', async (err) => {
          console.error(err);
          await sock.sendMessage(jid, { text: '❌ Error al descargar este video.' });
          if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
        });
        return;
      }

      // Búsqueda de videos
      if (t.length > 2) {
        try {
          const r = await yts(txt);
          const vids = r.videos.slice(0, 3);
          if (!vids.length) {
            await sock.sendMessage(jid, { text: 'No encontré resultados en YouTube.' });
            return;
          }

          lastSearch[jid] = vids;
          
          let msg = `🎵 *Resultados de YouTube encontrados:*\n\n`;
          for (let i = 0; i < vids.length; i++) {
            msg += `*${i + 1}.* ${vids[i].title}\n⏱️ Duración: _${vids[i].timestamp}_\n\n`;
          }
          msg += `👉 Responde con el número y formato.\nEjemplos:\n*1 mp3* (Para audio)\n*1 mp4* (Para video)`;

          await sock.sendMessage(jid, { 
            image: { url: vids[0].thumbnail }, // Selección nativa de propiedad thumbnail del primer elemento
            caption: msg 
          });
        } catch (e) {
          console.error(e);
        }
      }
    } catch (error) {
      console.error('Error en el manejador de mensajes:', error);
    }
  });
}
start();
