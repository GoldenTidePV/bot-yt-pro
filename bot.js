const express = require('express');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const P = require('pino');
const ytdl = require('@distube/ytdl-core');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 10000;
app.get('/', (req, res) => res.send('BOT YT PRO OK'));
app.listen(PORT, () => console.log('WEB OK en ' + PORT));

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth');
    const sock = makeWASocket({ auth: state, logger: P({ level: 'silent' }), printQRInTerminal: false });
    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, qr } = update;
        if (qr) {
            console.log('QR RECIBIDO:');
            qrcode.generate(qr, { small: true });
        }
        if (connection === 'open') console.log('CONECTADO');
        if (connection === 'close') startBot();
    });

    sock.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message) return;
        const remoteJid = msg.key.remoteJid;
        const text = msg.message.conversation || msg.message.extendedTextMessage?.text || "";
        if (!text) return;
        console.log('Mensaje: ' + text);

        if (text.includes('youtube.com') || text.includes('youtu.be')) {
            await sock.sendMessage(remoteJid, { text: '⏳ Bajando tu video, espera...' });
            try {
                const info = await ytdl.getInfo(text);
                const title = info.videoDetails.title;
                const file = `/tmp/${Date.now()}.mp3`;
                ytdl(text, { filter: 'audioonly', quality: 'highestaudio' }).pipe(fs.createWriteStream(file)).on('finish', async () => {
                    await sock.sendMessage(remoteJid, { audio: fs.readFileSync(file), mimetype: 'audio/mpeg' }, { quoted: msg });
                    await sock.sendMessage(remoteJid, { text: `✅ Listo: ${title}` });
                    fs.unlinkSync(file);
                });
            } catch (e) {
                console.log(e);
                await sock.sendMessage(remoteJid, { text: '❌ No pude bajarlo. Verifica que el link sea válido.' });
            }
        } else if (text.toLowerCase() === 'hola' || text.toLowerCase() === 'ping') {
            await sock.sendMessage(remoteJid, { text: 'Bot YT listo. Mándame un link de YouTube y te lo bajo ✅' });
        }
    });
}
startBot();
