const express = require('express');
const { default: makeWASocket, useMultiFileAuthState } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const P = require('pino');
const fs = require('fs');
const ytdl = require('yt-dlp-exec');

const app = express();
app.get('/', (req, res) => res.send('BOT YT PRO 2.0 OK'));
app.listen(process.env.PORT || 10000, () => console.log('WEB OK'));

let lastSearch = {}; // guarda lo que buscaste para elegir 1,2,3

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth');
    const sock = makeWASocket({ auth: state, logger: P({ level: 'silent' }) });
    sock.ev.on('creds.update', saveCreds);
    sock.ev.on('connection.update', (u) => {
        if (u.qr) qrcode.generate(u.qr, { small: true });
        if (u.connection === 'open') console.log('CONECTADO');
        if (u.connection === 'close') startBot();
    });

    sock.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message) return;
        const jid = msg.key.remoteJid;
        const text = (msg.message.conversation || msg.message.extendedTextMessage?.text || "").trim();
        if (!text) return;

        const commonOpts = {
            noCheckCertificates: true,
            noPlaylist: true,
            extractorArgs: "youtube:player_client=android"
        };

        // SI ELIGES 1, 2 o 3
        if (['1','2','3'].includes(text) && lastSearch[jid]) {
            const video = lastSearch[jid][parseInt(text)-1];
            if (!video) return;
            await sock.sendMessage(jid, { text: `⏳ Bajando: ${video.title}...` });
            try {
                const out = `/tmp/${Date.now()}.mp3`;
                await ytdl(video.webpage_url, { ...commonOpts, extractAudio: true, audioFormat: 'mp3', audioQuality: 0, output: out });
                await sock.sendMessage(jid, { audio: fs.readFileSync(out), mimetype: 'audio/mpeg', fileName: `${video.title}.mp3` }, { quoted: msg });
                if (fs.existsSync(out)) fs.unlinkSync(out);
            } catch (e) { console.log(e); await sock.sendMessage(jid, { text: '❌ YouTube lo bloqueó, intenta con otro.' }); }
            return;
        }

        // SI ES LINK DIRECTO
        if (text.includes('youtube.com') || text.includes('youtu.be')) {
            await sock.sendMessage(jid, { text: '⏳ Bajando tu video, espera...' });
            try {
                const out = `/tmp/${Date.now()}.mp3`;
                await ytdl(text, { ...commonOpts, extractAudio: true, audioFormat: 'mp3', audioQuality: 0, output: out });
                await sock.sendMessage(jid, { audio: fs.readFileSync(out), mimetype: 'audio/mpeg' }, { quoted: msg });
                if (fs.existsSync(out)) fs.unlinkSync(out);
                await sock.sendMessage(jid, { text: '✅ Listo' });
            } catch (e) { console.log(e); await sock.sendMessage(jid, { text: '❌ No pude bajarlo. Prueba con el nombre del video en vez del link.' }); }
            return;
        }

        // SI ES NOMBRE - BUSCADOR CON MINIATURAS
        if (text.length > 1) {
            await sock.sendMessage(jid, { text: `🔎 Buscando "${text}"...` });
            try {
                const result = await ytdl(`ytsearch3:${text}`, { ...commonOpts, dumpSingleJson: true, skipDownload: true });
                const videos = result.entries || [result];
                lastSearch[jid] = videos;

                for (let i = 0; i < videos.length; i++) {
                    const v = videos[i];
                    const thumb = v.thumbnail || v.thumbnails?.[v.thumbnails.length-1]?.url;
                    await sock.sendMessage(jid, {
                        image: { url: thumb },
                        caption: `*${i+1}. ${v.title}*\n📺 ${v.uploader}\n⏱️ ${v.duration_string}\n\nResponde con *${i+1}* para bajarlo`
                    });
                }
            } catch (e) { console.log(e); await sock.sendMessage(jid, { text: '❌ No encontré resultados' }); }
        }
    });
}
startBot();
