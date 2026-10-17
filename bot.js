const express = require('express');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const ytdlp = require('yt-dlp-exec');

const app = express();
const PORT = 10000;

app.get('/', (req, res) => {
  res.send('BOT ON - No se duerme');
});

app.listen(PORT, () => console.log(`WEB OK en puerto ${PORT}`));

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState('auth');
  
  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: false,
    browser: ['Bot-YT', 'Chrome', '1.0']
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (update) => {
    const { connection, qr } = update;
    if (qr) {
      console.log('QR RECIBIDO - Escanealo:');
      qrcode.generate(qr, { small: true });
    }
    if (connection === 'open') console.log('BOT CONECTADO OK');
    if (connection === 'close') {
      console.log('Desconectado, reconectando...');
      startBot();
    }
  });

  sock.ev.on('messages.upsert', async ({ messages }) => {
    const m = messages[0];
    if (!m.message || m.key.fromMe) return;
    
    const text = m.message.conversation || m.message.extendedTextMessage?.text || '';
    const from = m.key.remoteJid;

    if (text.includes('youtube.com') || text.includes('youtu.be')) {
      await sock.sendMessage(from, { text: '⏳ Descargando video/audio...' });
      
      try {
        const fileName = `video_${Date.now()}.mp4`;
        await ytdlp(text, {
          output: fileName,
          format: 'best[ext=mp4]/best'
        });

        if (fs.existsSync(fileName)) {
          await sock.sendMessage(from, {
            video: fs.readFileSync(fileName),
            caption: '✅ Video descargado'
          });
          fs.unlinkSync(fileName);
        }
      } catch (e) {
        console.log(e);
        await sock.sendMessage(from, { text: '❌ Error al descargar. Intenta con otro link.' });
      }
    }
  });
}

startBot();
