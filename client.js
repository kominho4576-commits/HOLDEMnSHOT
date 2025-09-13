const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const logEl = document.getElementById('log');
const phaseEl = document.getElementById('phase');
const turnEl  = document.getElementById('turn');
const timerEl = document.getElementById('timer');
const myCodeEl= document.getElementById('myCode');
const wsInfoEl= document.getElementById('wsInfo');

const btnQuick   = document.getElementById('btnQuick');
const btnCreate  = document.getElementById('btnCreate');
const btnJoin    = document.getElementById('btnJoin');
const btnExchange= document.getElementById('btnExchange');
const btnNext    = document.getElementById('btnNext');
const roomCodeIn = document.getElementById('roomCode');

let W=0,H=0, DPR=window.devicePixelRatio||1;
let state = { phase:'WAITING', you:{hand:[]}, opp:{hand:[]}, public:[], seat:null, canExchange:false, exchangeSelectable:[false,false] };
let selected = new Set();
let myId = null;

// WebSocket endpoint resolution
function resolveWS(){
  if (window.WS_URL) return window.WS_URL;
  // try same-origin path /ws (for reverse proxy setups)
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.host}/ws`;
}
let WS_URL = resolveWS();
wsInfoEl.textContent = WS_URL;

let socket;
function connectWS(){
  socket = new WebSocket(WS_URL);
  socket.addEventListener('open', ()=> log('WS connected'));
  socket.addEventListener('close', ()=> log('WS disconnected'));
  socket.addEventListener('message', onMessage);
}
connectWS();

function onMessage(ev){
  const msg = JSON.parse(ev.data);
  if(msg.t==='WELCOME'){ myId = msg.id; }
  if(msg.t==='ROOM_JOINED'){ myCodeEl.textContent=msg.code; log(`방 입장: ${msg.code}`); }
  if(msg.t==='MATCH_FOUND'){ log('매칭 완료'); }
  if(msg.t==='STATE'){ state = msg.state; updateUI(); }
  if(msg.t==='RESULT'){ log(JSON.stringify(msg)); }
}

function log(t){ logEl.textContent = (t+'\n'+logEl.textContent).slice(0,4000); }

function resize(){
  const wrapH = document.getElementById('wrap').clientHeight;
  const wrapW = document.getElementById('wrap').clientWidth;
  DPR = window.devicePixelRatio||1;
  canvas.width  = Math.floor(wrapW*DPR);
  canvas.height = Math.floor(wrapH*DPR);
  canvas.style.width  = wrapW+'px';
  canvas.style.height = wrapH+'px';
  W = canvas.width; H = canvas.height;
}
resize();
window.addEventListener('resize', resize);

function drawRoundedRect(x,y,w,h,r){ ctx.beginPath(); ctx.moveTo(x+r,y); ctx.arcTo(x+w,y, x+w,y+h, r); ctx.arcTo(x+w,y+h, x,y+h, r); ctx.arcTo(x,y+h, x,y, r); ctx.arcTo(x,y, x+w,y, r); ctx.closePath(); }

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
  drawRoundedRect(0,0,w,h,12*DPR);
  ctx.fill(); ctx.stroke();
  if(!faceUp){
    ctx.save(); ctx.clip();
    ctx.globalAlpha=0.2;
    for(let i=-h;i<h;i+=12*DPR){
      ctx.beginPath(); ctx.moveTo(0,i); ctx.lineTo(w,i+h); ctx.strokeStyle='#9ad'; ctx.lineWidth=1*DPR; ctx.stroke();
    }
    ctx.restore(); ctx.restore(); return;
  }
  const isRed = (card.suit==='H'||card.suit==='D');
  ctx.fillStyle = isRed? '#c93636':'#101420';
  ctx.font = `${12*DPR}px system-ui`;
  const rankText = (card.rank===14?'A':card.rank===13?'K':card.rank===12?'Q':card.rank===11?'J':card.rank);
  ctx.fillText(rankText, 8*DPR, 16*DPR);
  ctx.fillText(card.suit, 8*DPR, 28*DPR);
  ctx.beginPath();
  suitPath(card.suit, w/2, h/2, Math.min(w,h)*0.18);
  ctx.fillStyle = (card.suit==='H'||card.suit==='D')? '#e74d4d':'#243043';
  ctx.fill();
  if(card.suit==='J'){
    ctx.fillStyle='#e2a93b';
    ctx.font = `${18*DPR}px system-ui`; ctx.fillText('JOKER', w/2-30*DPR, h-10*DPR);
  }
  ctx.restore();
}

canvas.addEventListener('click', e=>{
  const rect=canvas.getBoundingClientRect(), x=(e.clientX-rect.left)*DPR, y=(e.clientY-rect.top)*DPR;
  if(state.canExchange){
    const cx=W/2, wy=H-140*DPR, gap=90*DPR, cw=80*DPR, ch=120*DPR;
    for(let i=0;i<state.you.hand.length;i++){
      const xx = cx + (i===0?-gap:gap) - cw/2;
      const yy = wy - ch/2;
      if(x>xx && x<xx+cw && y>yy && y<yy+ch){
        if(!state.exchangeSelectable[i]) return;
        if(selected.has(i)) selected.delete(i); else { if(selected.size<2) selected.add(i); }
        break;
      }
    }
    draw();
  }
});

btnQuick.onclick = ()=> socket.send(JSON.stringify({t:'JOIN_RANDOM'}));
btnCreate.onclick= ()=> socket.send(JSON.stringify({t:'CREATE_ROOM'}));
btnJoin.onclick  = ()=> socket.send(JSON.stringify({t:'JOIN_ROOM', code: roomCodeIn.value.trim()}));
btnExchange.onclick = ()=>{
  socket.send(JSON.stringify({t:'REQUEST_EXCHANGE', indices: Array.from(selected)}));
  selected.clear();
};
btnNext.onclick = ()=> socket.send(JSON.stringify({t:'CONFIRM_NEXT'}));

function updateUI(){
  phaseEl.textContent = state.phase;
  turnEl.textContent  = state.isYourTurn? '내 차례' : '상대 차례';
  btnExchange.disabled = !state.canExchange;
  btnNext.disabled     = !state.canProceed;
  draw();
}

function draw(){
  ctx.clearRect(0,0,W,H);
  ctx.fillStyle='#0f1522'; ctx.fillRect(0,0,W,H);
  const cx=W/2, cy=H/2, cw=80*DPR, ch=120*DPR, gap=90*DPR;
  for(let i=0;i<5;i++){
    const x = cx + (i-2)*gap - cw/2;
    drawCard(x, cy - ch/2, cw, ch, state.public[i]||{rank:0,suit:'?'}, !!state.public[i]);
  }
  const myY = H-140*DPR, myGap=90*DPR;
  for(let i=0;i<2;i++){
    const x = cx + (i===0?-myGap:myGap) - cw/2;
    const hl = selected.has(i);
    const canSel = state.exchangeSelectable[i];
    drawCard(x, myY - ch/2, cw, ch, state.you.hand[i]||{rank:0,suit:'?'}, true, hl||canSel);
  }
  const opY = 140*DPR;
  for(let i=0;i<2;i++){
    const x = cx + (i===0?-myGap:myGap) - cw/2;
    drawCard(x, opY - ch/2, cw, ch, {rank:0,suit:'?'}, false);
  }
  ctx.fillStyle='#9ab'; ctx.font=`${14*DPR}px system-ui`;
  ctx.fillText('교환은 카드 최대 2장까지, 클릭으로 선택 후 [교환 완료].', 16*DPR, H-16*DPR);
}
updateUI();
