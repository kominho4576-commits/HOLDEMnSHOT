// Hold'em&SHOT server (Node.js, ws)
// Minimal room + quick match + AI fallback + round flow + poker evaluator

const http = require('http');
const WebSocket = require('ws');
const PORT = process.env.PORT || 3000;

const server = http.createServer((req, res)=>{
  res.writeHead(200, {'Content-Type':'text/plain'});
  res.end('Holdem&SHOT server alive\n');
});

const wss = new WebSocket.Server({ server });

let nextClientId = 1;
let rooms = new Map(); // code -> {code, players:[clientId...], state, bullets}
let quickQueue = []; // [{id,name,bullets,ts}]
let clients = new Map(); // id -> {ws, name, bullets, roomCode, isAI}

function send(ws, obj){ try{ ws.send(JSON.stringify(obj)); }catch{} }
function sendTo(id, obj){ const c=clients.get(id); if (c) send(c.ws, obj); }
function broadcastRoom(room, obj){ room.players.forEach(pid=> sendTo(pid, obj)); }
function getOpponentId(room, id){ return room.players.find(p=>p!==id); }
function now(){ return Date.now(); }

wss.on('connection', ws=>{
  const id = nextClientId++;
  clients.set(id, {ws, name:`P${id}`, bullets:3, roomCode:null, isAI:false});
  send(ws, {t:'hello', id});
  ws.on('message', data => {
    let msg = null; try{ msg = JSON.parse(data) } catch { return; }
    onMessage(id, msg);
  });
  ws.on('close', ()=> onClose(id));
});

function onMessage(id, m){
  const c = clients.get(id); if (!c) return;
  if (m.t==='quick'){
    c.name = m.name || c.name; c.bullets = clamp(m.bullets||3,1,3);
    // Try to pair immediately
    // remove old entries for this id
    quickQueue = quickQueue.filter(q=>q.id!==id);
    quickQueue.push({id, ts: now()});
    send(c.ws, {t:'connecting'});
    tryMatchQuick();
    // Schedule AI fallback in 8s
    setTimeout(()=>{
      // Still not in a room?
      const cc = clients.get(id);
      if (!cc || cc.roomCode) return;
      // Create room vs AI
      const code = genCode();
      const room = {code, players:[id], bullets: c.bullets, state:null};
      rooms.set(code, room);
      cc.roomCode = code;
      sendTo(id, {t:'room', room: {code, players:[id]}});
      // add AI
      addAIOpponent(code);
    }, 8000);
  }
  else if (m.t==='createRoom'){
    c.name = m.name || c.name; c.bullets = clamp(m.bullets||3,1,3);
    const code = genCode();
    const room = {code, players:[id], bullets: c.bullets, state:null};
    rooms.set(code, room);
    c.roomCode = code;
    send(c.ws, {t:'room', room: {code, players:[id]}});
  }
  else if (m.t==='joinRoom'){
    c.name = m.name || c.name; c.bullets = clamp(m.bullets||3,1,3);
    const code = (m.code||"").toUpperCase();
    const room = rooms.get(code);
    if (!room) return send(c.ws, {t:'joinFail', reason:'존재하지 않는 코드'});
    if (room.players.length>=2) return send(c.ws, {t:'joinFail', reason:'가득 찬 방'});
    room.players.push(id);
    c.roomCode = code;
    broadcastRoom(room, {t:'room', room: {code, players:[...room.players]}});
    // start a game when two present
    startRound(room);
  }
  else if (m.t==='leaveRoom'){
    leaveRoom(id);
  }
  else if (m.t==='ready'){
    const room = getRoomOf(id); if (!room) return;
    room.state.ready[id] = true;
    tryAdvancePhase(room);
  }
  else if (m.t==='next'){
    const room = getRoomOf(id); if (!room) return;
    room.state.ready[id] = true;
    tryAdvancePhase(room);
  }
  else if (m.t==='exchange'){
    const room = getRoomOf(id); if (!room) return;
    const st = room.state;
    if (st.phase!=='Flop' && st.phase!=='Turn' && st.phase!=='River') return;
    if (st.exchangeCount[id]>=2) return;
    const idx = (m.idx||[]).slice(0, 2-st.exchangeCount[id]);
    // replace cards
    idx.forEach(i => { if (i===0||i===1){ st.hands[id][i] = draw(st); st.exchangeCount[id]++; } });
    st.exchangeSelectable[id] = [0,1]; // still can pick again until ready or used 2
    st.message = `${clients.get(id).name}: exchanged ${idx.length}`;
    pushState(room);
  }
  else if (m.t==='resign'){
    const room = getRoomOf(id); if (!room) return;
    endGame(room, getOpponentId(room,id), id);
  }
  else if (m.t==='rouletteResult'){
    const room = getRoomOf(id); if (!room) return;
    const bang = !!m.bang;
    if (bang){
      // shooter dies immediately
      const opp = getOpponentId(room, id);
      endGame(room, opp, id);
    }else{
      // next round
      startRound(room);
    }
  }
}

function onClose(id){
  const c = clients.get(id);
  if (!c) return;
  leaveRoom(id);
  clients.delete(id);
  // remove from queue
  quickQueue = quickQueue.filter(q=>q.id!==id);
}

function tryMatchQuick(){
  while(quickQueue.length>=2){
    const a = quickQueue.shift();
    const b = quickQueue.shift();
    const ca = clients.get(a.id), cb = clients.get(b.id);
    if (!ca || !cb) continue;
    const code = genCode();
    const room = {code, players:[ca.id, cb.id], bullets: ca.bullets, state:null};
    rooms.set(code, room);
    ca.roomCode = code; cb.roomCode = code;
    broadcastRoom(room, {t:'room', room: {code, players:[...room.players]}});
    startRound(room);
  }
}

function addAIOpponent(code){
  const room = rooms.get(code); if (!room) return;
  const botId = nextClientId++;
  const ws = { send: (_)=>{}, readyState:1 };
  const bot = {ws, name: randAIName(), bullets: clients.get(room.players[0]).bullets, roomCode: code, isAI:true};
  clients.set(botId, bot);
  room.players.push(botId);
  broadcastRoom(room, {t:'room', room:{code, players:[...room.players]}});
  startRound(room);
}

function getRoomOf(id){
  const c=clients.get(id); if (!c) return null;
  return rooms.get(c.roomCode);
}

function leaveRoom(id){
  const c = clients.get(id); if (!c) return;
  const code = c.roomCode; if (!code) return;
  const room = rooms.get(code); if (!room) return;
  room.players = room.players.filter(p=>p!==id);
  if (room.players.length===0){ rooms.delete(code); return; }
  // if game ongoing, opponent wins
  if (room.state) {
    const opp = room.players[0];
    endGame(room, opp, id);
  } else {
    broadcastRoom(room, {t:'room', room:{code, players:[...room.players]}});
  }
  c.roomCode = null;
}

function startRound(room){
  // init deck
  const deck = freshDeck();
  shuffle(deck);
  const st = {
    round: (room.state?.round||0)+1,
    phase: 'Deal',
    deck,
    board: [null,null,null,null,null],
    hands: {},
    hp: {},
    ready:{},
    exchangeCount:{},
    exchangeSelectable:{},
    turnNote:"",
    message:""
  };
  room.players.forEach(pid=>{
    st.hands[pid] = [draw(st), draw(st)];
    st.hp[pid] = 1; // 1 life per spec (we track game-level as immediate death in roulette)
    st.ready[pid] = false;
    st.exchangeCount[pid]=0;
    st.exchangeSelectable[pid]=[0,1];
  });
  room.state = st;
  st.message = "카드 배분 완료. 둘 다 Ready → Flop";
  pushState(room);
}

function tryAdvancePhase(room){
  const st = room.state;
  if (!st) return;
  // both ready?
  const allReady = room.players.every(pid=>st.ready[pid]);
  if (!allReady) { pushState(room); return; }
  // advance
  if (st.phase==='Deal'){
    st.phase='Flop'; st.ready = flagReset(st.ready);
    st.board[0]=draw(st); st.board[1]=draw(st); st.board[2]=draw(st);
    st.message="Flop 공개. 각자 0~2장 교환 가능 → 둘 다 Ready면 Turn";
    pushState(room);
    aiMaybeAct(room);
  } else if (st.phase==='Flop'){
    st.phase='Turn'; st.ready = flagReset(st.ready);
    st.board[3]=draw(st);
    st.message="Turn 공개. 교환 가능 → Ready면 River";
    pushState(room);
    aiMaybeAct(room);
  } else if (st.phase==='Turn'){
    st.phase='River'; st.ready = flagReset(st.ready);
    st.board[4]=draw(st);
    st.message="River 공개. 마지막 교환 → Ready면 Showdown";
    pushState(room);
    aiMaybeAct(room);
  } else if (st.phase==='River'){
    st.phase='Showdown'; st.ready = flagReset(st.ready);
    // evaluate winner
    const a = room.players[0], b = room.players[1];
    const ra = bestRank(st.hands[a], st.board);
    const rb = bestRank(st.hands[b], st.board);
    let winner = null, loser = null, tie=false;
    const cmp = compareRank(ra, rb);
    if (cmp>0){ winner=a; loser=b; } else if (cmp<0){ winner=b; loser=a; } else { tie=true; }
    let message = `Showdown: ${nameOf(a)} ${ra.name} vs ${nameOf(b)} ${rb.name}`;
    if (tie){
      st.message = message + " → 무승부, 다음 라운드";
      pushState(room);
      setTimeout(()=>startRound(room), 1000);
    }else{
      st.message = message + ` → ${nameOf(winner)} 승리. 패자는 러시안룰렛`;
      pushState(room);
      // Joker effects
      const loserHasJoker = hasJoker(st.hands[loser], st.board);
      const winnerHasJoker = hasJoker(st.hands[winner], st.board);
      let bullets = room.bullets;
      if (loserHasJoker) { // 면제
        broadcastRoom(room, {t:'message', text:`${nameOf(loser)} Joker: 러시안룰렛 면제`});
        startRound(room); return;
      }
      if (winnerHasJoker){ bullets += 1; broadcastRoom(room, {t:'message', text:`${nameOf(winner)} Joker: 상대 총알 +1`}); }
      broadcastRoom(room, {t:'roulette', bullets});
    }
  } else if (st.phase==='Showdown'){
    // nothing
  }
}

function pushState(room){
  const st = room.state;
  room.players.forEach(pid=>{
    const opp = getOpponentId(room, pid);
    sendTo(pid, {t:'state', state: serializeStateFor(pid, st)});
  });
}

function serializeStateFor(pid, st){
  const opp = Object.keys(st.hands).find(k=>parseInt(k)!==pid);
  return {
    round: st.round,
    phase: st.phase,
    board: st.board.slice(),
    you: { name: nameOf(pid), hp: st.hp[pid], hand: st.hands[pid].slice(), exchangeSelectable: st.exchangeSelectable[pid] },
    opp:  { name: nameOf(parseInt(opp)), hp: st.hp[opp], hand: ["??","??"], exchangeSelectable: []},
    turnNote: "",
    message: st.message
  };
}

function nameOf(pid){ return clients.get(parseInt(pid))?.name || "Player"; }

function flagReset(map){
  const m = {}; Object.keys(map).forEach(k=>m[k]=false); return m;
}

/* ---- Cards / Deck ---- */
function freshDeck(){
  const deck=[];
  const suits = ['S','H','D','C'];
  const ranks = ['A','2','3','4','5','6','7','8','9','T','J','Q','K'];
  for (const s of suits) for (const r of ranks) deck.push(r+s);
  deck.push('JK'); deck.push('JK');
  return deck;
}
function shuffle(a){ for (let i=a.length-1;i>0;i--){ const j=(Math.random()*(i+1))|0; [a[i],a[j]]=[a[j],a[i]]; } }
function draw(st){ return st.deck.pop(); }
function hasJoker(hand, board){ return [...hand, ...board.filter(Boolean)].includes('JK'); }

/* ---- AI behavior ---- */
function aiMaybeAct(room){
  const ai = room.players.find(pid => clients.get(pid)?.isAI);
  if (!ai) return;
  const st = room.state;
  const my = ai;
  // random small exchange (0~2)
  const k = Math.floor(Math.random()*3);
  const idxs = [];
  for (let i=0;i<k;i++) idxs.push(Math.random()<.5?0:1);
  idxs.forEach(i=> st.hands[my][i] = draw(st));
  st.exchangeCount[my] = Math.min(2, (st.exchangeCount[my]||0)+idxs.length);
  st.message = `${nameOf(my)}(AI): exchanged ${idxs.length}`;
  st.ready[my]=true;
  pushState(room);
}

/* ---- Poker evaluation (7 -> best 5) ---- */
const RMAP = {'A':14,'K':13,'Q':12,'J':11,'T':10,'9':9,'8':8,'7':7,'6':6,'5':5,'4':4,'3':3,'2':2};
function bestRank(hand, board){
  const cards = [...hand, ...board.filter(Boolean)];
  // filter out jokers in evaluation: treat as lowest (rarely appears in standard holdem)
  const filtered = cards.filter(c=>c!=='JK');
  let best = null;
  const n=filtered.length;
  function choose5(start, picked){
    if (picked.length===5){
      const r = rank5(picked);
      if (!best || compareRank(r, best)>0) best=r;
      return;
    }
    for (let i=start;i<n;i++) choose5(i+1, picked.concat(filtered[i]));
  }
  choose5(0, []);
  return best || rank5(filtered.slice(0,5));
}
function compareRank(a,b){
  // compare major then kickers lexicographically
  for (let i=0;i<Math.max(a.val.length,b.val.length);i++){
    const va = a.val[i]||0, vb=b.val[i]||0;
    if (va!==vb) return va-vb;
  }
  return 0;
}
function rank5(cards){
  // cards like "AS","TD"...
  const ranks = cards.map(c=>RMAP[c[0]]).sort((a,b)=>b-a);
  const suits = cards.map(c=>c[1]);
  const counts = new Map();
  ranks.forEach(r=>counts.set(r,(counts.get(r)||0)+1));
  const byCount = [...counts.entries()].sort((a,b)=> (b[1]-a[1]) || (b[0]-a[0]));
  const isFlush = suits.every(s=>s===suits[0]);
  const uniq = [...new Set(ranks)];
  let isStraight=false, topStraight=0;
  // handle A-5 straight
  const rset = new Set(ranks);
  for (let hi=14; hi>=5; hi--){
    const seq = [hi,hi-1,hi-2,hi-3,hi-4];
    if (seq.every(x=>rset.has(x))){ isStraight=true; topStraight=hi; break; }
  }
  if (!isStraight && [14,5,4,3,2].every(x=>rset.has(x))){ isStraight=true; topStraight=5; }

  if (isStraight && isFlush) return {name:"Straight Flush", val:[8, topStraight]};
  if (byCount[0][1]===4) return {name:"Four of a Kind", val:[7, byCount[0][0], byCount[1][0]]};
  if (byCount[0][1]===3 && byCount[1][1]===2) return {name:"Full House", val:[6, byCount[0][0], byCount[1][0]]};
  if (isFlush) return {name:"Flush", val:[5, ...ranks]};
  if (isStraight) return {name:"Straight", val:[4, topStraight]};
  if (byCount[0][1]===3) {
    const kickers = ranks.filter(r=>r!==byCount[0][0]);
    return {name:"Three of a Kind", val:[3, byCount[0][0], ...kickers]};
  }
  if (byCount[0][1]===2 && byCount[1][1]===2){
    const hi = Math.max(byCount[0][0], byCount[1][0]);
    const lo = Math.min(byCount[0][0], byCount[1][0]);
    const kicker = ranks.find(r=>r!==hi && r!==lo);
    return {name:"Two Pair", val:[2, hi, lo, kicker||0]};
  }
  if (byCount[0][1]===2){
    const pair = byCount[0][0];
    const ks = ranks.filter(r=>r!==pair);
    return {name:"One Pair", val:[1, pair, ...ks]};
  }
  return {name:"High Card", val:[0, ...ranks]};
}

function genCode(){
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s=""; for(let i=0;i<5;i++) s+=chars[(Math.random()*chars.length)|0];
  while (rooms.has(s)) s=genCode();
  return s;
}

function clamp(x,a,b){ return Math.max(a, Math.min(b,x)); }
function randAIName(){
  const pool = ["CobaltBot","NeonQueen","PaperTiger","SilentJack","K-Dealer","Ghost512","LunaAI","Maverick","Golem","Basilisk"];
  return pool[(Math.random()*pool.length)|0];
}

server.listen(PORT, ()=> console.log("HoldemSHOT server on", PORT));
