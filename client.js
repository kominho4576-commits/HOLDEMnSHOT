// ======= Elements =======
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const phaseEl = document.getElementById('phase');
const turnEl  = document.getElementById('turn');
const wsEl    = document.getElementById('ws');

const ovrHome = document.getElementById('ovrHome');
const ovrConnecting = document.getElementById('ovrConnecting');
const connDesc = document.getElementById('connDesc');
const ovrModal = document.getElementById('ovrModal');
const modalContent = document.getElementById('modalContent');

const inpName = document.getElementById('inpName');
const selBullets = document.getElementById('selBullets');
const btnPlay = document.getElementById('btnPlay');
const btnCreate = document.getElementById('btnCreate');
const btnJoin = document.getElementById('btnJoin');
const inpCode = document.getElementById('inpCode');

const btnReady = document.getElementById('btnReady');
const btnNext  = document.getElementById('btnNext');
const btnResign= document.getElementById('btnResign');

// ======= Viewport =======
let W=0,H=0,DPR=window.devicePixelRatio||1;
function resize(){
  const wrap = document.getElementById('wrap');
  const wrapW = wrap.clientWidth, wrapH = wrap.clientHeight;
  DPR = window.devicePixelRatio||1;
  canvas.width  = Math.floor(wrapW*DPR);
  canvas.height = Math.floor(wrapH*DPR);
  canvas.style.width = wrapW+'px';
  canvas.style.height= wrapH+'px';
  W=canvas.width; H=canvas.height;
  draw();
}
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', ()=>setTimeout(resize,100));
resize();

// ======= State =======
let socket=null;
let myId=null, myName="Guest";
let preferredBullets=1;
let selected = new Set();   // indices for exchange
let iAmReady = false;       // local ready flag for exchange

let state = {
  phase:'WAITING',
  seat:null,
  you:{hand:[]}, opp:{hand:[]},
  public:[],
  canExchange:false, canProceed:false,
  exchangeSelectable:[false,false],
  bothReady:false,
  room:{ code:null, bullets:1 }
};

// ======= WebSocket & Keepalive =======
let sendQueue = []; // messages queued before socket OPEN

function resolveWS(){
  if (window.WS_URL) return window.WS_URL;
  const proto = location.protocol==='https:'?'wss':'ws';
  return `${proto}://${location.host}/ws`;
}
let WS_URL = resolveWS();
wsEl.textContent = WS_URL;

function connect(){
  socket = new WebSocket(WS_URL);
  socket.addEventListener('open', ()=>{
    scheduleKeepAlive();
    // flush queued messages
    while(sendQueue.length){
      try{ socket.send(JSON.stringify(sendQueue.shift())); }catch(_){}
    }
  });
  socket.addEventListener('message', onMessage);
}
connect();

// safe sender
function sendMsg(obj){
  if (socket && socket.readyState === 1){
    socket.send(JSON.stringify(obj));
  } else {
    sendQueue.push(obj);
  }
}

let pingTimer=null;
function scheduleKeepAlive(){
  if (pingTimer) clearInterval(pingTimer);
  const serverHttp = WS_URL.replace(/^wss?:\/\//,'https://').replace(/\/ws$/,'/health');
  const ping = ()=>{ fetch(serverHttp,{mode:'no-cors',cache:'no-store'}).catch(()=>{}); };
  ping(); pingTimer = setInterval(ping, 4*60*1000);
}

// ======= Messages =======
function onMessage(ev){
  const msg = JSON.parse(ev.data);
  if (msg.t==='WELCOME'){ myId=msg.id; }
  if (msg.t==='ROOM_JOINED'){ state.room.code = msg.code; }
  if (msg.t==='MATCH_FOUND'){ hideConnecting(); }
  if (msg.t==='STATE'){ 
    state = msg.state; 
    if (state.phase==='FLOP' || state.phase==='TURN' || state.phase==='RIVER'){
      iAmReady = false; selected.clear();
    }
    updateUI();
  }
  if (msg.t==='RESULT'){
    if (msg.type==='SHOWDOWN'){ showShowdown(msg.data); }
    if (msg.type==='ROULETTE'){ showRoulette(msg.data); }
    if (msg.type==='END'){ showEnd(msg.data); }
  }
}

// ======= Lobby actions =======
function cleanName(s){ return (s||'').trim().slice(0,12)||'Guest'; }

btnPlay.onclick = ()=>{
  myName = cleanName(inpName.value);
  preferredBullets = +selBullets.value || 1;
  showConnecting("Searching players…");
  sendMsg({t:'JOIN_RANDOM', name: myName, bullets: preferredBullets});
  ovrHome.style.display='none';
};
btnCreate.onclick = ()=>{
  myName = cleanName(inpName.value);
  preferredBullets = +selBullets.value || 1;
  showConnecting("Waiting for your friend…");
  sendMsg({t:'CREATE_ROOM', name: myName, bullets: preferredBullets});
  ovrHome.style.display='none';
};
btnJoin.onclick = ()=>{
  myName = cleanName(inpName.value);
  const code = (inpCode.value||'').trim().toUpperCase();
  if (!code) return;
  showConnecting("Joining room…");
  sendMsg({t:'JOIN_ROOM', code, name: myName});
  ovrHome.style.display='none';
};

// ======= Exchange / Next / Resign =======
btnReady.onclick = ()=>{
  if (!state.canExchange || iAmReady) return;
  sendMsg({t:'READY_EXCHANGE', indices: Array.from(selected)});
  iAmReady = true;
  updateUI();
};
btnNext.onclick  = ()=> sendMsg({t:'CONFIRM_NEXT'});
btnResign.onclick= ()=> sendMsg({t:'RESIGN'});

// ======= Canvas interaction =======
canvas.addEventListener('click', e=>{
  if(!state.canExchange || iAmReady) return;
  const rect = canvas.getBoundingClientRect();
  const x = (e.clientX-rect.left)*DPR;
  const y = (e.clientY-rect.top)*DPR;

  const cx=W/2, cw=80*DPR, ch=120*DPR, myY=H-140*DPR, myGap=90*DPR;
  for(let i=0;i<2;i++){
    const rx = cx + (i===0?-myGap:myGap) - cw/2;
    const ry = myY - ch/2;
    if(x>rx && x<rx+cw && y>ry && y<ry+ch){
      if(!state.exchangeSelectable[i]) return;
      if(selected.has(i)) selected.delete(i); else { if(selected.size<2) selected.add(i); }
      draw(); break;
    }
  }
});

// ======= UI / Draw =======
function updateUI(){
  phaseEl.textContent = state.phase;
  turnEl.textContent  = state.isYourTurn ? 'Your turn' : 'Opponent';
  btnReady.disabled = !(state.canExchange && !iAmReady);
  btnNext.disabled  = state.canExchange || !state.canProceed; // Next disabled during exchange
  btnResign.disabled= (state.seat==null);
  draw();
}

function drawRoundedRect(x,y,w,h,r){
  ctx.beginPath(); ctx.moveTo(x+r,y);
  ctx.arcTo(x+w,y, x+w,y+h, r); ctx.arcTo(x+w,y+h, x,y+h, r);
  ctx.arcTo(x,y+h, x,y, r); ctx.arcTo(x,y, x+w,y, r); ctx.closePath();
}
function suitPath(s, cx, cy, size){
  ctx.beginPath();
  if(s==='S'){
    ctx.moveTo(cx, cy-size*0.9);
    ctx.bezierCurveTo(cx+size*0.8, cy-size*0.2, cx+size*0.4, cy+size*0.6, cx, cy+size*0.9);
    ctx.bezierCurveTo(cx-size*0.4, cy+size*0.6, cx-size*0.8, cy-size*0.2, cx, cy-size*0.9);
    ctx.moveTo(cx, cy+size*0.9); ctx.lineTo(cx-size*0.2, cy+size*1.3); ctx.lineTo(cx+size*0.2, cy+size*1.3); ctx.closePath();
  } else if(s==='H'){
    ctx.moveTo(cx, cy+size*0.7);
    ctx.bezierCurveTo(cx+size*0.9, cy, cx+size*0.6, cy-size*0.8, cx, cy-size*0.2);
    ctx.bezierCurveTo(cx-size*0.6, cy-size*0.8, cx-size*0.9, cy, cx, cy+size*0.7);
  } else if(s==='D'){
    ctx.moveTo(cx, cy-size*0.9);
    ctx.lineTo(cx+size*0.8, cy); ctx.lineTo(cx, cy+size*0.9); ctx.lineTo(cx-size*0.8, cy); ctx.closePath();
  } else if(s==='C'){
    const r=size*0.5;
    ctx.arc(cx, cy-r, r, 0, Math.PI*2);
    ctx.moveTo(cx+r, cy+r*0.2); ctx.arc(cx, cy+r*0.2, r, 0, Math.PI*2);
    ctx.moveTo(cx-r, cy+r*0.2); ctx.arc(cx-r, cy+r*0.2, r, 0, Math.PI*2);
    ctx.moveTo(cx, cy+r*1.2); ctx.lineTo(cx-size*0.2, cy+size*1.4); ctx.lineTo(cx+size*0.2, cy+size*1.4);
  } else if(s==='J'){
    const r=size; for(let i=0;i<5;i++){ const a=(-Math.PI/2)+i*2*Math.PI/5; const x=cx+Math.cos(a)*r; const y=cy+Math.sin(a)*r; (i?ctx.lineTo(x,y):ctx.moveTo(x,y)); const a2=a+Math.PI/5; ctx.lineTo(cx+Math.cos(a2)*r*0.4, cy+Math.sin(a2)*r*0.4); }
    ctx.closePath();
  }
}
function drawCard(x,y,w,h,card,faceUp=true, highlight=false){
  ctx.save(); ctx.translate(x,y);
  ctx.fillStyle = faceUp? '#fafafa' : '#1a2030';
  ctx.strokeStyle = highlight? '#ffd24d' : '#2a2f3a';
  ctx.lineWidth = 2*DPR;
  drawRoundedRect(0,0,w,h,12*DPR); ctx.fill(); ctx.stroke();
  if(!faceUp){
    ctx.save(); ctx.clip(); ctx.globalAlpha=0.2;
    for(let i=-h;i<h;i+=12*DPR){
      ctx.beginPath(); ctx.moveTo(0,i); ctx.lineTo(w,i+h); ctx.strokeStyle='#9ad'; ctx.lineWidth=1*DPR; ctx.stroke();
    }
    ctx.restore(); ctx.restore(); return;
  }
  const isRed=(card.suit==='H'||card.suit==='D');
  ctx.fillStyle=isRed? '#c93636':'#101420'; ctx.font=`${12*DPR}px system-ui`;
  const rankText=card.rank===14?'A':card.rank===13?'K':card.rank===12?'Q':card.rank===11?'J':card.rank;
  ctx.fillText(rankText, 8*DPR, 16*DPR); ctx.fillText(card.suit, 8*DPR, 28*DPR);
  ctx.beginPath(); suitPath(card.suit, w/2, h/2, Math.min(w,h)*0.18);
  ctx.fillStyle=isRed? '#e74d4d':'#243043'; ctx.fill();
  if(card.suit==='J'){ ctx.fillStyle='#e2a93b'; ctx.font=`${18*DPR}px system-ui`; ctx.fillText('JOKER', w/2-30*DPR, h-10*DPR); }
  ctx.restore();
}

function draw(){
  ctx.clearRect(0,0,W,H);
  ctx.fillStyle='#0f1522'; ctx.fillRect(0,0,W,H);

  const cx=W/2, cy=H/2, cw=80*DPR, ch=120*DPR, gap=90*DPR;
  // board
  for(let i=0;i<5;i++){
    const x=cx+(i-2)*gap - cw/2;
    drawCard(x, cy-ch/2, cw, ch, state.public[i]||{rank:0,suit:'?'}, !!state.public[i]);
  }
  // my hand
  const myY=H-140*DPR, myGap=90*DPR;
  for(let i=0;i<2;i++){
    const x=cx+(i===0?-myGap:myGap)-cw/2;
    const hl = selected.has(i);
    const canSel = state.exchangeSelectable[i] && !iAmReady;
    drawCard(x, myY-ch/2, cw, ch, state.you.hand[i]||{rank:0,suit:'?'}, true, hl||canSel);
  }
  // opponent back
  const opY=140*DPR;
  for(let i=0;i<2;i++){
    const x=cx+(i===0?-myGap:myGap)-cw/2;
    drawCard(x, opY-ch/2, cw, ch, {rank:0,suit:'?'}, false);
  }
}

// ======= Overlays / Modal =======
function showConnecting(text){ connDesc.textContent=text||'Connecting…'; ovrConnecting.style.display='flex'; }
function hideConnecting(){ ovrConnecting.style.display='none'; }

function openModal(html){ modalContent.innerHTML=html; ovrModal.style.display='flex'; }
function closeModal(){ ovrModal.style.display='none'; }

function prettyCard(c){ const r=c.rank===14?'A':c.rank===13?'K':c.rank===12?'Q':c.rank===11?'J':c.rank; return `${c.suit}${r}`; }
function prettyHand(h){ return h.map(prettyCard).join(' '); }

function showShowdown(d){
  const a=d.names.A, b=d.names.B;
  const winTxt = d.winner===-1 ? 'Draw' : `Winner: ${d.winner===0?a:b}`;
  openModal(`
    <h1>Showdown</h1>
    <div class="row">
      <div class="col"><div class="muted">${a}</div><pre>${prettyHand(d.hands.A)}</pre></div>
      <div class="col"><div class="muted">${b}</div><pre>${prettyHand(d.hands.B)}</pre></div>
    </div>
    <p style="font-size:18px">${winTxt}</p>
    <div class="center"><button class="btn" id="btnCloseSD">OK</button></div>
  `);
  document.getElementById('btnCloseSD').onclick=()=>closeModal();
}

function showRoulette(d){
  const loser = d.loserSeat===0? d.names.A : d.names.B;
  const body = d.fired==null ? `<p>Chamber spinning…</p>` :
               (d.fired ? `<p style="font-size:18px">💥 ${loser} is dead.</p>` :
                          `<p style="font-size:18px">😮 ${loser} survives. Next round.</p>`);
  openModal(`
    <h1>Russian Roulette</h1>
    <p class="muted">Loaded bullets: ${d.bullets}</p>
    ${body}
    <div class="center"><button class="btn" id="btnCloseRL">OK</button></div>
  `);
  document.getElementById('btnCloseRL').onclick=()=>closeModal();
}

function showEnd(d){
  const winner = d.dead===0? d.names.B : d.names.A;
  const loser  = d.dead===0? d.names.A : d.names.B;
  openModal(`
    <h1>Game Over</h1>
    <p style="font-size:18px">Winner: ${winner}</p>
    <p>Loser: ${loser}</p>
    <div class="center"><button class="btn" id="btnHome">Home</button></div>
  `);
  document.getElementById('btnHome').onclick=()=>location.reload();
}
