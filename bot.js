const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const express = require('express');
const yts = require('yt-search');
const QRCode = require('qrcode');

const app = express();
const PORT = process.env.PORT || 10000;

let lastSearch = {};
let lastQR = null;

app.get('/ping', (req,res) => res.send('ok'));

app.get('/', async (req,res) => {
  if(!lastQR) return res.send('BOT CONECTADO O ESPERANDO QR - revisa /ping para cron');
  try{
    const qrImage = await QRCode.toDataURL(lastQR);
    res.send(`<h1>Escanea este QR con WhatsApp</h1><img src="${qrImage}" style="width:300px"><br><br><p>Se actualiza solo, no recargues mucho. Si no sirve, dale Deploy de nuevo en Render.</p>`);
  }catch(e){ res.send('Error generando QR'); }
});

app.listen(PORT, () => console.log('Server en puerto', PORT));

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState('auth');
  const sock = makeWASocket({ auth: state, printQRInTerminal: false });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;
    if(qr) lastQR = qr;
    if(connection === 'close'){
      const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
      if(shouldReconnect) startBot();
    } else if(connection === 'open'){
      console.log('CONECTADO');
      lastQR = null;
    }
  });

  sock.ev.on('messages.upsert', async ({ messages }) => {
    const msg = messages[0];
    if (!msg.message || msg.key.fromMe) return;
    const jid = msg.key.remoteJid;
    const text = msg.message.conversation || msg.message.extendedTextMessage?.text || '';
    if (!text) return;
    const cleanText = text.trim().toLowerCase();
    if (cleanText === 'cancelar' || cleanText === 'c' || cleanText === '0') {
      delete lastSearch[jid];
      await sock.sendMessage(jid, { text: '❌ Cancelado. Mándame otro nombre.' });
      return;
    }
    if (['1','2','3'].includes(cleanText) && lastSearch[jid]) {
      const video = lastSearch[jid][parseInt(cleanText)-1];
      if(video) await sock.sendMessage(jid, { text: `⏬ Bajando: ${video.title}\n${video.url}` });
      delete lastSearch[jid];
      return;
    }
    try {
      const r = await yts(text);
      const videos = r.videos.slice(0,3);
      if(videos.length===0) return;
      lastSearch[jid]=videos;
      for(let i=0;i<videos.length;i++){
        const v=videos[i];
        await sock.sendMessage(jid, { image:{url:v.thumbnail}, caption:`${i+1}. ${v.title}\n${v.timestamp}\nResponde 1,2,3 o escribe cancelar` });
      }
    } catch(e){ console.log(e); }
  });
}
startBot();
