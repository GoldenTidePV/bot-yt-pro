const express = require('express');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const P = require('pino');

const app = express();
const PORT = process.env.PORT || 10000;

app.get('/', (req, res) => res.send('BOT BAILEYS OK - Activo'));
app.listen(PORT, () => console.log('WEB OK en puerto ' + PORT));

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth');
    const sock = makeWASocket({
        auth: state,
        logger: P({ level: 'silent' }),
        printQRInTerminal: false
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) {
            console.log('QR RECIBIDO - Escanealo ya:');
            qrcode.generate(qr, { small: true });
        }
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) startBot();
        } else if (connection === 'open') {
            console.log('CONECTADO A WHATSAPP');
        }
    });

    sock.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message) return;
        
        // ESTO ES PARA QUE FUNCIONE CUANDO TE HABLAS A TI MISMO
        const fromMe = msg.key.fromMe;
        const remoteJid = msg.key.remoteJid;
        const text = msg.message.conversation || msg.message.extendedTextMessage?.text || "";

        console.log(`Mensaje recibido: ${text} - fromMe: ${fromMe}`);

        // Responder si te hablas a ti mismo o si alguien te habla
        if (text.toLowerCase() === 'hola' || text.toLowerCase() === 'ping') {
            await sock.sendMessage(remoteJid, { text: 'Hola! Bot funcionando. Ya te respondo a ti mismo ✅' });
        }
    });
}

startBot();
