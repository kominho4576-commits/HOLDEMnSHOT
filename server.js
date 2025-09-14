// npm i ws
const WebSocket = require('ws');
const http = require('http');
const url = require('url');

const server = http.createServer((req,res)=>{
  if (req.url === '/health'){ res.writeHead(200); res.end('ok'); return; }
  res.writeHead(200); res.end('Holdem&SHOT server');
});
const wss = new WebSocket.Server({ noServer:true });

server.on('upgrade', (request, socket, head)=>{
  const { pathname } = url.parse(request.url);
  if (pathname==='/ws'){
    wss.handleUpgrade(request, socket, head, (ws)=> wss.emit('connection', ws, request));
  } else socket.destroy();
});

// ===== Data =====
const clients = new Map(); // ws -> {id,name,room?}
const rooms = new Map();   // code -> Room
const queues = {1:[],2:[],3:[]}; // bullets-based quick match queues

const BOT_NAMES = ['Raven','Blitz','Echo','Karma','Juno','Loki','Nova','Pyro','Quark','Vega','Zed','Iris'];

// ===== Utils =====
function uid(){ return Math.random().toString(36).slice(2,10); }
function roomCode(){ return Math.random().toString(36).slice(2,6).toUpperCase(); }
function freshDeck(){
  const ranks=[2,3,4,5,6,7,8,9,10,11,12,13,14], suits=['S','H','D','C'];
  const d=[]; for(const s of suits) for(const r of ranks) d.push({rank:r,suit:s});
  d.push({rank:0,suit:'J'}); d.push({rank:0,suit:'J'});
  for(let i=d.length-1;i>0;i--){ const j=(Math.random()*(i+1))|0; [d[i],d[j]]=[d[j],d[i]]; }
  return d;
}
const clampBullets = n=> Math.min(Math.max(+n||1,1),3);

// ===== Rooms =====
function wrapPlayer(c){ return { id:c.id, name:c.name, socket:c.socket, hand:[], hasJokerThisRound:false, alive:true, isBot:false, ready:false }; }

function createRoom(host, bullets, isCode=false){
  const code = roomCode();
  const r = {
    code,
    settings:{ bullets: clampBullets(bullets), isCode },
    players:[ host?wrapPlayer(host):null, null ],
    deck:[], board:[], phase:'WAITING', turnIndex:0,
    lastRoundLoser:undefined, roulette:null,
    readyExchange:[false,false] // both must be true to advance
  };
  rooms.set(code, r);
  if (host) host.room=code;
  return r;
}

function joinRoom(cli, code){
  const r = rooms.get(code); if(!r) return false;
  if(!r.players[0]){ r.players[0]=wrapPlayer(cli); cli.room=r.code; return true; }
  if(!r.players[1]){ r.players[1]=wrapPlayer(cli); cli.room=r.code; return true; }
  return false;
}

function addBot(room){
  const bot = { id:'BOT_'+uid(), name: BOT_NAMES[Math.floor(Math.random()*BOT_NAMES.length)], socket:null, hand:[], hasJokerThisRound:false, alive:true, isBot:true, ready:false };
  if(!room.players[0]) room.players[0]=bot; else room.players[1]=bot;
  startIfReady(room);
}
function startIfReady(room){
  if(room.players[0] && room.players[1]){
    broadcast(room,{t:'MATCH_FOUND'});
    room.phase='PREFLOP'; nextPhase(room);
  }
}

function broadcast(room, data){
  const s=JSON.stringify(data);
  for(const p of room.players){
    if(!p || p.isBot) continue;
    if(p.socket && p.socket.readyState===1) p.socket.send(s);
  }
}

// ===== Game loop =====
function nextPhase(room){
  switch(room.phase){
    case 'WAITING':
    case 'PREFLOP': dealPreflop(room); break;
    case 'FLOP':    revealMore(room,3); enterExchange(room); break;
    case 'TURN':    revealMore(room,1); enterExchange(room); break;
    case 'RIVER':   revealMore(room,1); enterExchange(room); break;
    case 'EXCHANGE_WAIT':
      // wait handled by READY_EXCHANGE; do nothing here
      break;
    case 'SHOWDOWN': showdown(room); break;
    case 'JOKER_CHECK': jokerCheck(room); break;
    case 'ROULETTE': roulettePhase(room); break;
  }
}

function dealPreflop(room){
  room.deck=freshDeck(); room.board=[];
  room.players.forEach(p=>{ p.hand=[]; p.hasJokerThisRound=false; p.ready=false; });
  for(const p of room.players){ p.hand.push(room.deck.pop()); p.hand.push(room.deck.pop()); p.hasJokerThisRound = p.hand.some(c=>c.suit==='J'); }
  room.phase='FLOP';
  updateState(room);
}

function revealMore(room, n){
  for(let i=0;i<n;i++) room.board.push(room.deck.pop());
  // remove jokers from board (joker is “ownership” only)
  for(let i=0;i<room.board.length;i++){ if(room.board[i].suit==='J'){ room.board[i]=room.deck.pop(); i--; } }
}

function enterExchange(room){
  room.phase='EXCHANGE_WAIT';
  room.readyExchange=[false,false];
  updateState(room); // clients see canExchange=true
  // Bot auto pick & ready
  const botIdx = room.players.findIndex(p=>p && p.isBot);
  if (botIdx!==-1){
    const bot = room.players[botIdx];
    const counts={}; for(const c of bot.hand){ counts[c.rank]=(counts[c.rank]||0)+1; }
    const singles = bot.hand.map((c,i)=>({c,i})).filter(x=>counts[x.c.rank]===1 && x.c.suit!=='J').sort((a,b)=>a.c.rank-b.c.rank);
    const idx = singles.slice(0,2).map(x=>x.i);
    idx.forEach(i=> bot.hand[i]=room.deck.pop());
    room.readyExchange[botIdx]=true;
    maybeAdvanceAfterExchange(room);
  }
}

function canExchangePhase(room){ return room.phase==='EXCHANGE_WAIT'; }

function viewStateFor(pl, room){
  const pub=[...room.board], idx=room.players.indexOf(pl);
  const opp = room.players[ idx===0?1:0 ];
  const phaseMap={
    EXCHANGE_WAIT: room.board.length===3?'FLOP':room.board.length===4?'TURN':'RIVER'
  };
  return {
    phase: phaseMap[room.phase] || room.phase,
    public:[pub[0]||null,pub[1]||null,pub[2]||null,pub[3]||null,pub[4]||null],
    isYourTurn: true,
    canExchange: canExchangePhase(room) && !pl.isBot,
    canProceed: !canExchangePhase(room),
    exchangeSelectable:[canExchangePhase(room), canExchangePhase(room)],
    bothReady: room.readyExchange[0] && room.readyExchange[1],
    you:{hand:pl.hand},
    opp:{hand: opp ? opp.hand.map(_=>({rank:0,suit:'?'})) : []},
    seat: idx,
    room:{code:room.code, bullets:room.settings.bullets}
  };
}
function updateState(room){
  for(const pl of room.players){
    if(!pl || pl.isBot || !pl.socket || pl.socket.readyState!==1) continue;
    pl.socket.send(JSON.stringify({t:'STATE', state: viewStateFor(pl, room)}));
  }
}

function handRank7(cards){
  function score5(a){
    const ranks=a.map(c=>c.rank).sort((x,y)=>y-x);
    const suits=a.map(c=>c.suit);
    const isFlush=suits.every(s=>s===suits[0]);
    const rset=new Set(ranks);
    let straightHigh=0; for(let hi=14;hi>=5;hi--){ const seq=[hi,hi-1,hi-2,hi-3,hi-4]; if(seq.every(v=>rset.has(v))) { straightHigh=hi; break; } }
    const counts={}; for(const r of ranks){ counts[r]=(counts[r]||0)+1; }
    const byCount=Object.entries(counts).sort((a,b)=> b[1]-a[1] || b[0]-a[0]);
    if(isFlush && straightHigh) return [8,straightHigh];
    if(byCount[0][1]===4) return [7,+byCount[0][0],+byCount[1][0]];
    if(byCount[0][1]===3 && byCount[1] && byCount[1][1]===2) return [6,+byCount[0][0],+byCount[1][0]];
    if(isFlush) return [5,...ranks];
    if(straightHigh) return [4,straightHigh];
    if(byCount[0][1]===3) return [3,+byCount[0][0], ...byCount.slice(1).map(x=>+x[0]).sort((a,b)=>b-a)];
    if(byCount[0][1]===2 && byCount[1] && byCount[1][1]===2){ const hi=Math.max(+byCount[0][0],+byCount[1][0]); const lo=Math.min(+byCount[0][0],+byCount[1][0]); const kicker=+byCount.find(x=>x[1]===1)[0]; return [2,hi,lo,kicker]; }
    if(byCount[0][1]===2){ const ks=byCount.filter(x=>x[1]===1).map(x=>+x[0]).sort((a,b)=>b-a); return [1,+byCount[0][0],...ks]; }
    return [0,...ranks];
  }
  let best=null;
  for(let i=0;i<7;i++)for(let j=i+1;j<7;j++){
    const five=cards.filter((_,k)=>k!==i && k!==j); const sc=score5(five);
    if(!best || compare(sc,best)>0) best=sc;
  }
  function compare(a,b){ for(let i=0;i<Math.max(a.length,b.length);i++){ const d=(a[i]||0)-(b[i]||0); if(d!==0) return d; } return 0; }
  return best;
}

function showdown(room){
  const [A,B]=room.players, board=room.board;
  const rA=handRank7(A.hand.concat(board)), rB=handRank7(B.hand.concat(board));
  const cmp=(a,b)=>{ for(let i=0;i<Math.max(a.length,b.length);i++){ const d=(a[i]||0)-(b[i]||0); if(d!==0) return d; } return 0; };
  const res=cmp(rA,rB); let winner; if(res>0) winner=0; else if(res<0) winner=1; else winner=-1;

  broadcast(room,{t:'RESULT', type:'SHOWDOWN', data:{
    winner,
    hands:{A:A.hand, B:B.hand},
    names:{A:A.name, B:B.name}
  }});

  if(winner===-1){ room.phase='PREFLOP'; nextPhase(room); return; }
  room.lastRoundLoser = winner===0?1:0;
  room.phase='JOKER_CHECK'; nextPhase(room);
}

function jokerCheck(room){
  const loser = room.lastRoundLoser, winner = loser===0?1:0;
  const pL = room.players[loser], pW = room.players[winner];
  let bullets = room.settings.bullets;
  let exempt = false;
  if(pL.hasJokerThisRound) exempt=true;
  if(pW.hasJokerThisRound) bullets += 1;
  if(exempt){
    broadcast(room,{t:'RESULT', type:'ROULETTE', data:{bullets, fired:null, loserSeat:loser, names:{A:room.players[0].name,B:room.players[1].name}}});
    room.phase='PREFLOP'; nextPhase(room); return;
  }
  room.roulette = { bullets, position: (Math.random()*6|0) };
  room.phase='ROULETTE';
  broadcast(room,{t:'RESULT', type:'ROULETTE', data:{bullets, fired:null, loserSeat:loser, names:{A:room.players[0].name,B:room.players[1].name}}});
  nextPhase(room);
}

function roulettePhase(room){
  const cyl=6, bullets = clampBullets(room.roulette.bullets);
  const chamber = room.roulette.position;
  const set = new Set(); while(set.size<bullets){ set.add((Math.random()*cyl|0)); }
  const fired = set.has(chamber);
  const loser = room.lastRoundLoser;
  if(fired){
    room.players[loser].alive=false;
    broadcast(room,{t:'RESULT', type:'ROULETTE', data:{bullets, fired:true, loserSeat:loser, names:{A:room.players[0].name,B:room.players[1].name}}});
    broadcast(room,{t:'RESULT', type:'END', data:{dead:loser, names:{A:room.players[0].name,B:room.players[1].name}}});
  }else{
    broadcast(room,{t:'RESULT', type:'ROULETTE', data:{bullets, fired:false, loserSeat:loser, names:{A:room.players[0].name,B:room.players[1].name}}});
    room.phase='PREFLOP'; nextPhase(room);
  }
}

function maybeAdvanceAfterExchange(room){
  if(room.readyExchange[0] && room.readyExchange[1]){
    // clear flags and go to next reveal or showdown
    room.readyExchange=[false,false];
    if(room.board.length===3) room.phase='TURN';
    else if(room.board.length===4) room.phase='RIVER';
    else room.phase='SHOWDOWN';
    updateState(room); nextPhase(room);
  }else{
    updateState(room);
  }
}

// ===== Bot helper ===== (already handled in enterExchange)

// ===== Sockets =====
wss.on('connection', (ws)=>{
  const cli = { id:uid(), socket:ws, name:'Guest', room:null };
  clients.set(ws, cli);
  ws.send(JSON.stringify({t:'WELCOME', id:cli.id}));

  ws.on('message', (buf)=>{
    let msg; try{ msg=JSON.parse(buf.toString()); }catch(e){ return; }

    if(msg.t==='CREATE_ROOM'){
      cli.name = (msg.name||'Guest').slice(0,12);
      const bullets = clampBullets(msg.bullets);
      const r = createRoom(cli, bullets, true);
      ws.send(JSON.stringify({t:'ROOM_JOINED', code:r.code, seat:0}));
      // No AI in code rooms
    }

    if(msg.t==='JOIN_ROOM'){
      cli.name = (msg.name||'Guest').slice(0,12);
      const ok = joinRoom(cli, (msg.code||'').toUpperCase());
      if(ok){
        const r = rooms.get(cli.room);
        ws.send(JSON.stringify({t:'ROOM_JOINED', code:r.code}));
        startIfReady(r); // start when 2nd joins
      }
    }

    if(msg.t==='JOIN_RANDOM'){
      cli.name = (msg.name||'Guest').slice(0,12);
      const bullets = clampBullets(msg.bullets);
      const q = queues[bullets];
      q.push(cli);
      // pair if 2 present immediately
      if(q.length>=2){
        const a=q.shift(), b=q.shift();
        const r = createRoom(a, bullets, false);
        r.players[1]=wrapPlayer(b); b.room=r.code;
        startIfReady(r);
      }else{
        // after 8 seconds, if still waiting, spawn bot
        setTimeout(()=>{
          const idx = q.indexOf(cli);
          if(idx!==-1){
            q.splice(idx,1);
            const r = createRoom(cli, bullets, false);
            addBot(r); // random name AI
          }
        }, 8000);
      }
    }

    if(msg.t==='READY_EXCHANGE'){
      const r = rooms.get(cli.room); if(!r || !canExchangePhase(r)) return;
      const seat = r.players[0] && r.players[0].id===cli.id ? 0 : 1;
      const p = r.players[seat];
      const idx = (msg.indices||[]).slice(0,2);
      idx.forEach(i=>{ if(i===0||i===1){ p.hand[i]=r.deck.pop(); } });
      r.readyExchange[seat]=true;
      maybeAdvanceAfterExchange(r);
    }

    if(msg.t==='CONFIRM_NEXT'){
      const r = rooms.get(cli.room); if(!r) return;
      if(!canExchangePhase(r)) nextPhase(r);
    }

    if(msg.t==='RESIGN'){
      const r = rooms.get(cli.room); if(!r) return;
      const seat = r.players[0].id===cli.id ? 0 : 1;
      broadcast(r,{t:'RESULT', type:'END', data:{dead:seat, names:{A:r.players[0].name,B:r.players[1].name}}});
    }
  });

  ws.on('close', ()=>{ clients.delete(ws); });
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, ()=> console.log('Holdem&SHOT ws server on :' + PORT));
