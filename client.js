// ====== 기본 참조 ======
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const phaseEl = document.getElementById('phase');
const turnEl  = document.getElementById('turn');
const wsEl    = document.getElementById('ws');
const ovrLobby= document.getElementById('ovrLobby');
const ovrModal= document.getElementById('ovrModal');
const modalContent = document.getElementById('modalContent');

const inpName  = document.getElementById('inpName');
const selBullets = document.getElementById('selBullets');
const btnQuick = document.getElementById('btnQuick');
const btnCreate= document.getElementById('btnCreate');
const btnJoin  = document.getElementById('btnJoin');
const inpCode  = document.getElementById('inpCode');

const btnExchange= document.getElementById('btnExchange');
const btnNext    = document.getElementById('btnNext');
const btnResign  = document.getElementById('btnResign');

// ====== 화면/리사이즈 ======
let W=0,H=0,DPR=window.devicePixelRatio||1;
function resize(){
  const wrap = document.getElementById('wrap');
  const wrapW = wrap.clientWidth, wrapH = wrap.clientHeight;
  DPR = window.devicePixelRatio||1;
  canvas.width = Math.floor(wrapW*DPR);
  canvas.height= Math.floor(wrapH*DPR);
  canvas.style.width = wrapW+'px';
  canvas.style.height= wrapH+'px';
  W = canvas.width; H = canvas.height;
  draw();
}
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', ()=>setTimeout(resize,100));
resize();

// ====== 상태 ======
let socket=null;
let myId=null;
let myName="Guest";
let prefBullets=1;
let state = {
  phase:'WAITING',
  seat:null,
  you:{hand:[]}, opp:{hand:[]},
  public:[],
  canExchange:false, canProceed:false,
  exchangeSelectable:[false,false],
  room:{ code:null, bullets:1 }
};
let selected = new Set();

// ====== WS 연결 & 자동 핑(서버 깨우기) ======
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
    // 자동 핑: 페이지가 열려있는 동안 4분마다 서버 /health 호출
    scheduleKeepAlive();
  });
  socket.addEventListener('message', onMessage);
  socket.addEventListener('close', ()=>{ /* 표시는 하지 않음 */ });
}
connect();

// Render Free 플랜 Keep-Alive (페이지 열려있는 동안만)
let pingTimer=null;
function scheduleKeepAlive(){
  if (pingTimer) clearInterval(pingTimer);
  const serverHttp = WS_URL.replace(/^wss?:\/\//,'https://').replace(/\/ws$/,'/health');
  const ping = ()=>{ fetch(serverHttp, {mode:'no-cors', cache:'no-store'}).catch(()=>{}); };
  ping(); // 첫 핑
  pingTimer = setInterval(ping, 4*60*1000); // 4분
}

// ====== 메시지 핸들 ======
function onMessage(ev){
  const msg = JSON.parse(ev.data);
  if (msg.t==='WELCOME'){ myId=msg.id; }
  if (msg.t==='ROOM_JOINED'){ state.room.code = msg.code; }
  if (msg.t==='MATCH_FOUND'){ /* 표시 생략 */ }
  if (msg.t==='STATE'){ state = msg.state; updateUI(); }
  if (msg.t==='RESULT'){
    if (msg.type==='SHOWDOWN'){ showShowdown(msg.data); }
    if (msg.type==='ROULETTE'){ showRoulette(msg.data); }
    if (msg.type==='END'){ showEnd(msg.data); }
  }
}

// ====== 로비 액션 ======
function cleanName(s){ return (s||'').trim().slice(0,12) || 'Guest'; }
btnQuick.onclick = ()=>{
  myName = cleanName(inpName.value);
  prefBullets = +selBullets.value;
  socket.send(JSON.stringify({t:'JOIN_RANDOM', name: myName, bullets: prefBullets}));
  ovrLobby.style.display='none';
};
btnCreate.onclick = ()=>{
  myName = cleanName(inpName.value);
  prefBullets = +selBullets.value;
  socket.send(JSON.stringify({t:'CREATE_ROOM', name: myName, bullets: prefBullets}));
  ovrLobby.style.display='none';
};
btnJoin.onclick = ()=>{
  myName = cleanName(inpName.value);
  const code = (inpCode.value||'').trim().toUpperCase();
  if (!code) return;
  socket.send(JSON.stringify({t:'JOIN_ROOM', code, name: myName}));
  ovrLobby.style.display='none';
};

// ====== 교환/진행/포기 ======
btnExchange.onclick = ()=>{
  socket.send(JSON.stringify({t:'REQUEST_EXCHANGE', indices: Array.from(selected)}));
  selected.clear();
};
btnNext.onclick = ()=> socket.send(JSON.stringify({t:'CONFIRM_NEXT'}));
btnResign.onclick = ()=> socket.send(JSON.stringify({t:'RESIGN'}));

// ====== 캔버스 입력(카드 선택) ======
canvas.addEventListener('click', e=>{
  const rect = canvas.getBoundingClientRect();
  const x = (e.clientX-rect.left)*DPR;
  const y = (e.clientY-rect.top)*DPR;
  if(!state.canExchange) return;
  const cx=W/2, cw=80*DPR, ch=120*DPR, myGap=90*DPR, myY=H-140*DPR;
  for(let i=0;i<2;i++){
    const rx = cx + (i===0?-myGap:myGap) - cw/2;
    const ry = myY - ch/2;
    const within = x>rx && x<rx+cw && y>ry && y<ry+ch;
    if(within && state.exchangeSelectable[i]){
      if(selected.has(i)) selected.delete(i); else { if(selected.size<2) selected.add(i); }
      draw(); // 즉시 하이라이트 반영
      break;
    }
  }
});

// ====== 렌더 ======
function updateUI(){
  phaseEl.textContent = state.phase;
  turnEl.textContent  = state.isYourTurn? '내 차례' : '상대 차례';
  btnExchange.disabled = !state.canExchange;
  btnNext.disabled     = !state.canProceed;
  btnResign.disabled   = !state.seat && state.seat!==0 ? true : false;
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
  ctx.fillStyle=isRed? '#c93636':'#101420'; ctx.font = `${12*DPR}px system-ui`;
  const rankText = card.rank===14?'A':card.rank===13?'K':card.rank===12?'Q':card.rank===11?'J':card.rank;
  ctx.fillText(rankText, 8*DPR, 16*DPR); ctx.fillText(card.suit, 8*DPR, 28*DPR);
  ctx.beginPath(); suitPath(card.suit, w/2, h/2, Math.min(w,h)*0.18);
  ctx.fillStyle = isRed? '#e74d4d':'#243043'; ctx.fill();
  if(card.suit==='J'){ ctx.fillStyle='#e2a93b'; ctx.font=`${18*DPR}px system-ui`; ctx.fillText('JOKER', w/2-30*DPR, h-10*DPR); }
  ctx.restore();
}

function draw(){
  ctx.clearRect(0,0,W,H);
  ctx.fillStyle='#0f1522'; ctx.fillRect(0,0,W,H);
  const cx=W/2, cy=H/2, cw=80*DPR, ch=120*DPR, gap=90*DPR;

  // 공용 5장
  for(let i=0;i<5;i++){
    const x=cx+(i-2)*gap - cw/2;
    drawCard(x, cy-ch/2, cw, ch, state.public[i]||{rank:0,suit:'?'}, !!state.public[i]);
  }
  // 내 2장
  const myY=H-140*DPR, myGap=90*DPR;
  for(let i=0;i<2;i++){
    const x=cx+(i===0?-myGap:myGap)-cw/2;
    const hl = selected.has(i);
    const canSel = state.exchangeSelectable[i];
    drawCard(x, myY-ch/2, cw, ch, state.you.hand[i]||{rank:0,suit:'?'}, true, hl||canSel);
  }
  // 상대 2장(뒷면)
  const opY=140*DPR;
  for(let i=0;i<2;i++){
    const x=cx+(i===0?-myGap:myGap)-cw/2;
    drawCard(x, opY-ch/2, cw, ch, {rank:0,suit:'?'}, false);
  }
  // 하단 안내
  ctx.fillStyle='#9ab'; ctx.font=`${14*DPR}px system-ui`;
  ctx.fillText('교환은 카드 최대 2장: 카드를 눌러 선택 → [교환 완료]', 16*DPR, H-16*DPR);
}

// ====== 쇼다운/룰렛/엔드 화면 ======
function c(html){ return html; }
function openModal(inner){ modalContent.innerHTML = inner; ovrModal.style.display='flex'; }
function closeModal(){ ovrModal.style.display='none'; }

function showShowdown(d){
  // d: {winner, hands:{A:[..],B:[..]}, names:{A,B}}
  const a = d.names.A, b = d.names.B;
  const winTxt = d.winner===-1 ? '무승부' : `승자: ${d.winner===0?a:b}`;
  openModal(c(`
    <h2>쇼다운</h2>
    <div class="row">
      <div class="col"><div class="label">${a}</div><pre>${prettyHand(d.hands.A)}</pre></div>
      <div class="col"><div class="label">${b}</div><pre>${prettyHand(d.hands.B)}</pre></div>
    </div>
    <p class="hero">${winTxt}</p>
    <div class="center"><button class="btn" id="btnCloseSD">확인</button></div>
  `));
  document.getElementById('btnCloseSD').onclick = ()=>{ closeModal(); };
}
function prettyHand(h){ return h.map(c=>`${c.suit}${(c.rank===14?'A':c.rank===13?'K':c.rank===12?'Q':c.rank===11?'J':c.rank)}`).join(' '); }

function showRoulette(d){
  // d: {bullets, fired:boolean|null(대기시), loserSeat, names:{A,B}}
  const loser = d.loserSeat===0? d.names.A : d.names.B;
  const bulletText = `러시안룰렛 — 장전: ${d.bullets}발`;
  const body = d.fired==null
    ? `<p>실린더 회전 중... 대기</p>`
    : (d.fired ? `<p class="hero">💥 ${loser} 사망!</p>` : `<p class="hero">😮 ${loser} 생존. 다음 라운드로</p>`);
  openModal(c(`
    <h2>${bulletText}</h2>
    <p class="muted">두 플레이어 모두 이 화면을 봅니다.</p>
    ${body}
    <div class="center"><button class="btn" id="btnCloseRL">확인</button></div>
  `));
  document.getElementById('btnCloseRL').onclick = ()=>{ closeModal(); };
}

function showEnd(d){
  // d: {dead:loserSeat, names:{A,B}}
  const winner = d.dead===0? d.names.B : d.names.A;
  const loser  = d.dead===0? d.names.A : d.names.B;
  openModal(c(`
    <h2>게임 종료</h2>
    <p class="hero">승자: ${winner}</p>
    <p>패자: ${loser}</p>
    <div class="center">
      <button class="btn" id="btnHome">홈으로</button>
    </div>
  `));
  document.getElementById('btnHome').onclick = ()=>{ location.reload(); };
}
