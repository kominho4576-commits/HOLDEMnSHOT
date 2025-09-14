
import express from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import compression from 'compression';
import path from 'path';
import { fileURLToPath } from 'url';
import { nanoid } from 'nanoid';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json());
app.use(helmet({
  contentSecurityPolicy: false, // keep simple for prototype; tighten later
}));
app.use(morgan('dev'));
app.use(compression());

// ---- In-memory matchmaking ----
const queue = [];  // { id, nickname, ts }
const rooms = new Map(); // code -> { players: [id], createdAt, roomId }

function genCode(len=6){
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out='';
  for(let i=0;i<len;i++) out += chars[Math.floor(Math.random()*chars.length)];
  return out;
}

app.get('/health', (req,res)=>{
  res.json({ ok:true, time: Date.now() });
});

app.post('/matchmake', async (req,res)=>{
  const nickname = (req.body?.nickname || 'Guest').slice(0,18);
  const me = { id: nanoid(10), nickname, ts: Date.now() };

  // remove stale
  const now = Date.now();
  while(queue.length && (now - queue[0].ts > 20000)) queue.shift();

  const partner = queue.shift();
  if (partner){
    const code = genCode();
    const roomId = nanoid(12);
    rooms.set(code, { players: [partner.id, me.id], createdAt: Date.now(), roomId });
    return res.json({ roomId, code, players: 2 });
  }

  // wait up to 8s
  queue.push(me);
  const start = Date.now();
  const sleep = (ms)=>new Promise(r=>setTimeout(r, ms));
  while(Date.now()-start < 8000){
    await sleep(200);
    for (const [code, room] of rooms.entries()){
      if (room.players.includes(me.id)){
        return res.json({ roomId: room.roomId, code, players: room.players.length });
      }
    }
  }
  // timeout: remove if still queued
  const idx = queue.findIndex(x => x.id === me.id);
  if (idx>=0) queue.splice(idx,1);
  return res.json({ ai:true, roomId: `ai-${nanoid(8)}` });
});

app.post('/rooms', (req,res)=>{
  const code = genCode();
  const roomId = nanoid(12);
  rooms.set(code, { players: [], createdAt: Date.now(), roomId });
  res.json({ code, roomId });
});

app.post('/rooms/:code/join', (req,res)=>{
  const code = String(req.params.code || '').toUpperCase();
  const room = rooms.get(code);
  if (!room) return res.status(404).json({ error:'room-not-found' });
  const pid = nanoid(10);
  room.players.push(pid);
  res.json({ ok:true, roomId: room.roomId, players: room.players.length });
});

// Optional debug
app.get('/debug', (req,res)=>{
  res.json({
    queue: queue.map(q=>({ id:q.id, nickname:q.nickname, age:Date.now()-q.ts })),
    rooms: Array.from(rooms.entries()).map(([code,r])=>({ code, players:r.players.length, age:Date.now()-r.createdAt }))
  });
});

// ---- Static PWA ----
const pubDir = path.join(__dirname, 'public');
app.use(express.static(pubDir, {
  setHeaders(res, p){
    // allow service worker to control scope
    if (p.endsWith('sw.js')) {
      res.setHeader('Service-Worker-Allowed', '/');
      res.setHeader('Cache-Control', 'no-cache');
    }
  }
}));

// Fallback to index.html for root
app.get('/', (req,res)=> res.sendFile(path.join(pubDir,'index.html')));

const PORT = process.env.PORT || 10000;
app.listen(PORT, ()=> console.log(`Hold'em & SHOT fullstack listening on :${PORT}`));
