// npm i ws
const WebSocket = require('ws');
const http = require('http');
const url = require('url');

const server = http.createServer((req,res)=>{
  // simple health
  if (req.url === '/health') { res.writeHead(200); res.end('ok'); return; }
  res.writeHead(200); res.end('Holdem&SHOT server');
});
const wss = new WebSocket.Server({ noServer: true });

server.on('upgrade', (request, socket, head) => {
  const { pathname } = url.parse(request.url);
  if (pathname === '/ws') {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  } else {
    socket.destroy();
  }
});

const clients = new Map(); // socket -> {id, room?}
const rooms = new Map();   // code -> Room
const queue = [];          // 빠른 매칭 대기열

function uid(){ return Math.random().toString(36).slice(2,10); }
function roomCode(){ return Math.random().toString(36).slice(2,6).toUpperCase(); }

function freshDeck(){
  const ranks=[2,3,4,5,6,7,8,9,10,11,12,13,14];
  const suits=['S','H','D','C'];
  const d=[];
  for(const s of suits) for(const r of ranks) d.push({rank:r,suit:s});
  d.push({rank:0,suit:'J'}); d.push({rank:0,suit:'J'});
  for(let i=d.length-1;i>0;i--){ const j=(Math.random()* (i+1))|0; [d[i],d[j]]=[d[j],d[i]]; }
  return d;
}

function createRoom(p1, p2=null){
  const code = roomCode();
  const room = {
    code, players: [
      { id: p1.id, socket:p1.socket, hand:[], hasJokerThisRound:false, alive:true, isBot:false },
      p2? { id: p2.id, socket:p2.socket, hand:[], hasJokerThisRound:false, alive:true, isBot:false } : null
    ], deck:[], board:[], turnIndex:0, phase:'WAITING',
    lastRoundLoser:undefined, roulette:null, botTimer:null
  };
  rooms.set(code, room);
  p1.room = code;
  if(p2) p2.room = code;
  return room;
}

function joinRoom(p, code){
  const r = rooms.get(code);
  if(!r) return false;
  if(!r.players[1]){ r.players[1]={ id: p.id, socket:p.socket, hand:[], hasJokerThisRound:false, alive:true, isBot:false }; p.room=code; return true; }
  return false;
}

function addBot(room){
  const bot = { id:'BOT_'+uid(), socket:null, hand:[], hasJokerThisRound:false, alive:true, isBot:true };
  if(!room.players[1]) room.players[1]=bot; else room.players[0]=bot;
  broadcast(room,{t:'MATCH_FOUND'});
  room.phase='PREFLOP'; nextPhase(room);
}

function broadcast(room, data){
  const s=JSON.stringify(data);
  for(const pl of room.players){
    if(!pl) continue;
    if(pl.isBot) continue;
    if(pl.socket && pl.socket.readyState===1) pl.socket.send(s);
  }
}

function nextPhase(room){
  switch(room.phase){
    case 'WAITING':
    case 'PREFLOP': dealPreflop(room); break;
    case 'FLOP':    revealMore(room, 3); room.phase='FLOP_EX'; updateState(room); botMaybeExchange(room); break;
    case 'TURN':    revealMore(room, 1); room.phase='TURN_EX'; updateState(room); botMaybeExchange(room); break;
    case 'RIVER':   revealMore(room, 1); room.phase='RIVER_EX'; updateState(room); botMaybeExchange(room); break;
    case 'FLOP_EX':
    case 'TURN_EX':
    case 'RIVER_EX':
      if(room.phase==='FLOP_EX') room.phase='TURN'; else if(room.phase==='TURN_EX') room.phase='RIVER'; else room.phase='SHOWDOWN';
      updateState(room);
      nextPhase(room);
      break;
    case 'SHOWDOWN': showdown(room); break;
    case 'JOKER_CHECK': jokerCheck(room); break;
    case 'ROULETTE': roulettePhase(room); break;
    default: break;
  }
}

function dealPreflop(room){
  room.deck = freshDeck();
  room.board=[]; room.players.forEach(p=>{p.hand=[]; p.hasJokerThisRound=false;});
  for(const p of room.players){ p.hand.push(room.deck.pop()); p.hand.push(room.deck.pop());
    p.hasJokerThisRound = p.hand.some(c=>c.suit==='J'); }
  room.phase='FLOP';
  updateState(room);
}

function revealMore(room, n){
  for(let i=0;i<n;i++){ room.board.push(room.deck.pop()); }
  for(let i=0;i<room.board.length;i++){
    if(room.board[i].suit==='J'){ room.board[i]=room.deck.pop(); i--; }
  }
}

function canExchangePhase(room){
  return room.phase==='FLOP_EX' || room.phase==='TURN_EX' || room.phase==='RIVER_EX';
}

function updateState(room){
  const pub = [...room.board];
  for(const pl of room.players){
    const you = pl;
    const opp = room.players.find(p=>p&&p.id!==pl.id);
    const state = {
      phase: room.phase.replace('_EX',''),
      public: [pub[0]||null,pub[1]||null,pub[2]||null,pub[3]||null,pub[4]||null],
      isYourTurn: true,
      canExchange: canExchangePhase(room) && !pl.isBot,
      canProceed: !canExchangePhase(room),
      exchangeSelectable: [canExchangePhase(room), canExchangePhase(room)],
      you: { hand: you.hand },
      opp: { hand: opp ? opp.hand.map(_=>({rank:0,suit:'?'})) : [] },
      seat: room.players.indexOf(you)
    };
    if(!pl.isBot && pl.socket && pl.socket.readyState===1){
      pl.socket.send(JSON.stringify({t:'STATE', state}));
    }
  }
}

function handRank7(cards){
  function score5(a){
    const ranks=a.map(c=>c.rank===1?14:c.rank).sort((x,y)=>y-x);
    const suits=a.map(c=>c.suit);
    const isFlush = suits.every(s=>s===suits[0]);
    const rset=new Set(ranks);
    let straightHigh=0;
    for(let hi=14;hi>=5;hi--){
      const seq=[hi,hi-1,hi-2,hi-3,hi-4];
      if(seq.every(v=>rset.has(v))) { straightHigh=hi; break; }
    }
    const counts = {};
    for(const r of ranks){ counts[r]=(counts[r]||0)+1; }
    const byCount = Object.entries(counts).sort((a,b)=> b[1]-a[1] || b[0]-a[0]);
    if(isFlush && straightHigh) return [8, straightHigh];
    if(byCount[0][1]===4) return [7, +byCount[0][0], +byCount[1][0]];
    if(byCount[0][1]===3 && byCount[1] && byCount[1][1]===2) return [6, +byCount[0][0], +byCount[1][0]];
    if(isFlush) return [5, ...ranks];
    if(straightHigh) return [4, straightHigh];
    if(byCount[0][1]===3) return [3, +byCount[0][0], ...byCount.slice(1).map(x=>+x[0]).sort((x,y)=>y-x)];
    if(byCount[0][1]===2 && byCount[1] && byCount[1][1]===2){
      const pairHi = Math.max(+byCount[0][0], +byCount[1][0]);
      const pairLo = Math.min(+byCount[0][0], +byCount[1][0]);
      const kicker = +byCount.find(x=>x[1]===1)[0];
      return [2, pairHi, pairLo, kicker];
    }
    if(byCount[0][1]===2){
      const kicker = byCount.filter(x=>x[1]===1).map(x=>+x[0]).sort((x,y)=>y-x);
      return [1, +byCount[0][0], ...kicker];
    }
    return [0, ...ranks];
  }
  let best=null;
  for(let i=0;i<7;i++)for(let j=i+1;j<7;j++){
    const five = cards.filter((_,idx)=> idx!==i && idx!==j);
    const sc = score5(five);
    if(!best || compare(sc,best)>0) best=sc;
  }
  function compare(a,b){ for(let i=0;i<Math.max(a.length,b.length);i++){ const d=(a[i]||0)-(b[i]||0); if(d!==0) return d; } return 0; }
  return best;
}

function showdown(room){
  const [A,B]=room.players;
  const board=room.board;
  const rankA = handRank7(A.hand.concat(board));
  const rankB = handRank7(B.hand.concat(board));
  const cmp = (a,b)=>{ for(let i=0;i<Math.max(a.length,b.length);i++){ const d=(a[i]||0)-(b[i]||0); if(d!==0) return d; } return 0; };
  let winner;
  const res = cmp(rankA, rankB);
  if(res>0) winner=0; else if(res<0) winner=1; else winner=-1;

  if(winner===-1){
    room.phase='PREFLOP';
    broadcast(room,{t:'RESULT', type:'SHOWDOWN', data:{winner:-1}});
    nextPhase(room);
  }else{
    const loser = winner===0?1:0;
    room.lastRoundLoser = loser;
    room.phase='JOKER_CHECK';
    broadcast(room,{t:'RESULT', type:'SHOWDOWN', data:{winner}});
    nextPhase(room);
  }
}

function jokerCheck(room){
  const loser = room.lastRoundLoser;
  const winner= loser===0?1:0;
  const pL = room.players[loser];
  const pW = room.players[winner];

  let bullets = 1;
  let exempt = false;
  if(pL.hasJokerThisRound) exempt = true;
  if(pW.hasJokerThisRound) bullets += 1;

  if(exempt){
    broadcast(room,{t:'RESULT', type:'ROULETTE', data:{note:'loser exempt by Joker'}});
    room.phase='PREFLOP'; nextPhase(room); return;
  }
  room.roulette = { bullets, position: (Math.random()*6|0) };
  room.phase='ROULETTE';
  updateState(room);
  roulettePhase(room);
}

function roulettePhase(room){
  const cyl = 6, bullets = room.roulette.bullets;
  const chamber = room.roulette.position;
  const bulletPos = new Set();
  while(bulletPos.size<bullets){ bulletPos.add((Math.random()*cyl|0)); }
  const fired = bulletPos.has(chamber);
  const loser = room.lastRoundLoser;
  if(fired){
    room.players[loser].alive=false;
    broadcast(room,{t:'RESULT', type:'END', data:{dead:loser}});
  }else{
    broadcast(room,{t:'RESULT', type:'ROULETTE', data:{fired:false}});
    room.phase='PREFLOP'; nextPhase(room);
  }
}

// ---- Simple Bot ----
function botMaybeExchange(room){
  const bot = room.players.find(p=>p.isBot);
  if(!bot || !canExchangePhase(room)) return;
  // Decide indices: drop up to 2 worst cards not in pair
  const hand = bot.hand.slice();
  // rank frequency
  const counts = {};
  for(const c of hand){ counts[c.rank]=(counts[c.rank]||0)+1; }
  const toSwap = [];
  // Prefer swapping singletons, lowest ranks first. Keep Jokers (they affect roulette only on possession).
  const singles = hand.map((c,i)=>({c,i})).filter(x=>counts[x.c.rank]===1 && x.c.suit!=='J').sort((a,b)=>a.c.rank-b.c.rank);
  for(const s of singles){ if(toSwap.length<2) toSwap.push(s.i); }
  // if less than 2, consider swapping jokers? Keeping joker is beneficial; skip.
  // perform swap
  toSwap.forEach(i=>{ bot.hand[i] = room.deck.pop(); });
  // proceed
  nextPhase(room);
}

wss.on('connection', (ws)=>{
  const cli = { id: uid(), socket: ws, room: null };
  clients.set(ws, cli);
  ws.send(JSON.stringify({t:'WELCOME', id: cli.id}));

  ws.on('message', (buf)=>{
    let msg; try{ msg=JSON.parse(buf.toString()); }catch(e){ return; }
    if(msg.t==='CREATE_ROOM'){
      const r = createRoom(cli);
      ws.send(JSON.stringify({t:'ROOM_JOINED', code:r.code, seat:0}));
      // if no one joins in 3s, add bot
      setTimeout(()=>{ const rr=rooms.get(r.code); if(rr && (!rr.players[1] || rr.players[1].isBot)){ addBot(rr); } }, 3000);
    }
    if(msg.t==='JOIN_ROOM'){
      const ok = joinRoom(cli, msg.code);
      if(ok){
        ws.send(JSON.stringify({t:'ROOM_JOINED', code:msg.code}));
        const r = rooms.get(msg.code);
        broadcast(r,{t:'MATCH_FOUND'});
        r.phase='PREFLOP'; nextPhase(r);
      }
    }
    if(msg.t==='JOIN_RANDOM'){
      queue.push(cli);
      if(queue.length>=2){
        const a=queue.shift(), b=queue.shift();
        const r = createRoom(a,b);
        broadcast(r,{t:'MATCH_FOUND'});
        r.phase='PREFLOP'; nextPhase(r);
      } else {
        // if no opponent in 3s, pair with bot
        setTimeout(()=>{
          const idx = queue.findIndex(x=>x===cli);
          if(idx!==-1){
            queue.splice(idx,1);
            const r = createRoom(cli,null);
            addBot(r);
          }
        }, 3000);
      }
    }
    if(msg.t==='REQUEST_EXCHANGE'){
      const r = rooms.get(cli.room); if(!r) return;
      if(!r.phase.endsWith('_EX')) return;
      const p = r.players.find(p=>p.id===cli.id);
      const idx = msg.indices.slice(0,2);
      idx.forEach(i=>{
        if(i===0||i===1){
          p.hand[i] = r.deck.pop();
        }
      });
      nextPhase(r);
    }
    if(msg.t==='CONFIRM_NEXT'){
      const r = rooms.get(cli.room); if(!r) return;
      if(!r.phase.endsWith('_EX')) nextPhase(r);
    }
  });

  ws.on('close', ()=>{
    const c = clients.get(ws);
    if(!c) return;
    clients.delete(ws);
  });
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, ()=> console.log('Holdem&SHOT ws server on :' + PORT));
