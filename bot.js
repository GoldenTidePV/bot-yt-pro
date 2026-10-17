const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const express = require('express');
const yts = require('yt-search');

const app = express();
const PORT = process.env.PORT || 10000;

let lastSearch = {};

app.get('/', (req, res) => {
  res.send('BOT YT PRO 2.0 OK');
});

// ESTE ES EL QUE VA A USAR CRON-JOB.ORG
app.get('/ping', (req, res) => {
  res.send('ok');
});

app.listen(PORT, () => console.log('Server en puerto', PORT));

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState('auth');

  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: true
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect } = update;
    if (connection === 'close') {
      const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
      if (shouldReconnect) startBot();
    } else if (connection === 'open') {
      console.log('CONECTADO');
    }
  });

  sock.ev.on('messages.upsert', async ({ messages }) => {
    const msg = messages[0];
    if (!msg.message || msg.key.fromMe) return;

    const jid = msg.key.remoteJid;
    const text = msg.message.conversation || msg.message.extendedTextMessage?.text || '';
    if (!text) return;

    const cleanText = text.trim().toLowerCase();

    // COMANDO PARA CANCELAR
    if (cleanText === 'cancelar' || cleanText === 'c' || cleanText === '0') {
      delete lastSearch[jid];
      await sock.sendMessage(jid, { text: '❌ Búsqueda cancelada. Mándame otro nombre.' });
      return;
    }

    // SI ELIGE 1, 2, 3
    if (['1', '2', '3'].includes(cleanText) && lastSearch[jid]) {
      const video = lastSearch[jid][parseInt(cleanText) - 1];
      if (video) {
        await sock.sendMessage(jid, { text: `⏬ Bajando: ${video.title}\n${video.url}\n\nMándame otro nombre para buscar más.` });
        // Aquí va tu código de descarga
      }
      delete lastSearch[jid];
      return;
    }

    // BUSQUEDA NUEVA
    try {
      const r = await yts(text);
      const videos = r.videos.slice(0, 3);
      if (videos.length === 0) return;

      lastSearch[jid] = videos;

      for (let i = 0; i < videos.length; i++) {
        const v = videos[i];
        await sock.sendMessage(jid, {
          image: { url: v.thumbnail },
          caption: `${i + 1}. ${v.title}\n${v.timestamp} - ${v.author.name}\n\nResponde con 1, 2 o 3 para descargar\nEscribe *cancelar* para cancelar`
        });
      }
    } catch (e) {
      console.log(e);
    }
  });
}

startBot();
