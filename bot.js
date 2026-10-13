const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const express = require('express');
const ytdl = require('@distube/ytdl-core');
const yts = require('yt-search');
const fs = require('fs');

let lastQR = null;
let busy = false;
const cacheBusqueda = new Map();
const app = express();
const PORT = process.env.PORT || 10000;

const client = new Client({
  authStrategy: new LocalAuth({ dataPath: 'auth' }),
  puppeteer: {
    headless: true,
    args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--disable-gpu','--single-process','--no-zygote']
  }
});

client.on('qr', qr => { lastQR = qr; });
client.on('ready', () => { lastQR = null; console.log('BOT LISTO'); });

function extraerLink(t){
  const m=t.match(/(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be|music\.youtube\.com)\S+/i);
  return m?m[0]:null;
}
async function descargar(msg, url, esVideo){
  if(busy){ await msg.reply('⏳ Ya estoy bajando otro, espera 30s'); return; }
  busy=true;
  let ruta=`/tmp/${Date.now()}.${esVideo?'mp4':'mp3'}`;
  try{
    await msg.reply(esVideo?'⏳ Bajando VIDEO 720p HQ...':'⏳ Bajando AUDIO HQ...');
    const info=await ytdl.getInfo(url);
    if(esVideo && info.videoDetails.lengthSeconds>600){ await msg.reply('❌ +10 min muy largo para 720p, pide audio'); busy=false; return; }
    await new Promise((res,rej)=>{
      const stream=esVideo?ytdl(url,{quality:'highest',filter:f=>f.hasVideo&&f.hasAudio&&f.container==='mp4'}):ytdl(url,{filter:'audioonly',quality:'highestaudio',highWaterMark:1<<25});
      stream.pipe(fs.createWriteStream(ruta)).on('finish',res).on('error',rej);
    });
    if(fs.statSync(ruta).size>95*1024*1024){ await msg.reply('❌ Pesa +95MB, no deja WhatsApp'); fs.unlinkSync(ruta); busy=false; return; }
    const media=MessageMedia.fromFilePath(ruta);
    await client.sendMessage(msg.from, media, {caption: esVideo?`🎬 720p - ${info.videoDetails.title}`:`🎧 HQ - ${info.videoDetails.title}`});
  }catch(e){ await msg.reply('❌ Error: '+e.message.slice(0,100)); }
  finally{ if(fs.existsSync(ruta)) fs.unlinkSync(ruta); busy=false; }
}

client.on('message_create', async msg=>{
  try{
    if(!msg.body) return;
    const chat=await msg.getChat();
    const esPropio=chat.id._serialized===client.info.wid._serialized;
    if(msg.fromMe &&!esPropio &&!chat.isGroup) return;
    const texto=msg.body.trim();
    const link=extraerLink(texto);
    if(link){ await descargar(msg,link,texto.toLowerCase().includes('video')); return; }
    if(/^(video\s+)?[1-5]$/.test(texto.toLowerCase())){
      const resu=cacheBusqueda.get(msg.from);
      if(!resu) return;
      const idx=parseInt(texto.match(/[1-5]/)[0])-1;
      const v=resu[idx];
      await descargar(msg,v.url,texto.toLowerCase().includes('video')); return;
    }
    if(texto.length<2||texto.length>80) return;
    console.log('Buscando:',texto);
    await client.sendMessage(msg.from,`🔎 Buscando *"${texto}"*...`);
    const b=await yts(texto);
    const videos=b.videos.slice(0,5);
    cacheBusqueda.set(msg.from,videos);
    let m=`*📺 Resultados para:* ${texto}\n━━━━━━━━━━━━━━━━━━━━\n\n`;
    videos.forEach((v,i)=>{ m+=`*${i+1}️⃣ ${v.title}*\n📺 ${v.author.name} • ⏱ ${v.timestamp} • 👁 ${v.views.toLocaleString()}\n🔗 ${v.url}\n\n`; });
    m+=`━━━━━━━━━━━━━━━━━━━━\n👉 *1* al *5* = AUDIO HQ\n👉 *video 1* = VIDEO 720p\nEj: *2* o *video 3*`;
    await msg.reply(m);
  }catch(e){ console.log(e.message); }
});

client.initialize();
app.get('/',(req,res)=>{
  if(lastQR){
    const img=`https://api.qrserver.com/v1/create-qr-code/?size=500x500&data=${encodeURIComponent(lastQR)}`;
    res.send(`<center><h1>Escanea QR con tu WhatsApp</h1><img src="${img}" style="width:380px;border:8px solid #000"><script>setTimeout(()=>location.reload(),10000)</script></center>`);
  }else res.send('<center><h1>✅ BOT YT HD LISTO</h1><p>Escribe en tu chat (Tú) el nombre de una canción</p></center>');
});
app.listen(PORT,()=>console.log(PORT));
