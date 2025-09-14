// Hold'em&SHOT client
const el = (id)=>document.getElementById(id);
const panels = ["panel-home","panel-connecting","panel-room","panel-join","panel-game"];
function show(id){ panels.forEach(p=>el(p).classList.add('hidden')); el(id).classList.remove('hidden'); }

// Global state
let ws = null;
let me = { id:null, name:"", bullets:3 };
let room = null;
let countdownTimer = null;
let countdownLeft = 8;
let selectedToExchange = new Set();
let maxExchangePerPhase = 2;
let phase = "Deal"; // Deal -> Flop -> Turn -> River -> Showdown
let roundNo = 1;

// UI bindings
const nickname = el('nickname');
const bulletCount = el('bulletCount');
el('btn-play').onclick = startQuick;
el('btn-create').onclick = createRoom;
el('btn-join').onclick = ()=>show('panel-join');
el('btn-back-join').onclick = ()=>show('panel-home');
el('btn-do-join').onclick = ()=> {
  const code = el('joinCode').value.trim().toUpperCase();
  if (!code) return;
  connectWS(()=> ws.send(JSON.stringify({t:"joinRoom", code, name:getName(), bullets:getBullets()})));
};
el('btn-leave-room').onclick = ()=> { ws?.send(JSON.stringify({t:'leaveRoom'})); show('panel-home'); };
el('btn-cancel-connect').onclick = cancelConnecting;

el('btn-ready').onclick = ()=> ws?.send(JSON.stringify({t:'ready'}));
el('btn-next').onclick = ()=> ws?.send(JSON.stringify({t:'next'}));
el('btn-exchange').onclick = doExchange;
el('btn-resign').onclick = ()=> ws?.send(JSON.stringify({t:'resign'}));

function getName(){ return nickname.value.trim() || "Player"+Math.floor(Math.random()*999); }
function getBullets(){ return parseInt(bulletCount.value,10); }

function startQuick(){
  show('panel-connecting');
  el('countdown').textContent = "8";
  countdownLeft = 8;
  if (countdownTimer) clearInterval(countdownTimer);
  countdownTimer = setInterval(()=>{
    countdownLeft--; if (countdownLeft<=0) clearInterval(countdownTimer);
    el('countdown').textContent = String(countdownLeft);
  },1000);
  connectWS(()=> ws.send(JSON.stringify({t:"quick", name:getName(), bullets:getBullets()})));
}

function createRoom(){
  connectWS(()=> ws.send(JSON.stringify({t:"createRoom", name:getName(), bullets:getBullets()})));
}

function cancelConnecting(){
  if (ws) { ws.close(); ws = null; }
  show('panel-home');
}

function connectWS(onOpen){
  if (ws) try{ws.close()}catch{}
  const proto = (location.protocol === 'https:') ? 'wss' : 'ws';
  const url = (window.HS_SERVER_URL || `${proto}://${location.host}`);
  ws = new WebSocket(url);
  ws.onopen = onOpen;
  ws.onmessage = onWS;
  ws.onclose = ()=> console.log("ws closed");
}

function onWS(ev){
  const msg = JSON.parse(ev.data);
  // console.log("rx", msg);

  if (msg.t==="hello"){
    me.id = msg.id;
  }
  else if (msg.t==="connecting"){
    show('panel-connecting');
  }
  else if (msg.t==="room"){
    room = msg.room;
    el('roomCode').textContent = room.code;
    el('roomStatus').textContent = room.players.length===2 ? "상대가 입장했습니다." : "상대를 기다리는 중…";
    show('panel-room');
  }
  else if (msg.t==="start"){
    // Game start
    applyState(msg.state);
    show('panel-game');
  }
  else if (msg.t==="state"){
    applyState(msg.state);
  }
  else if (msg.t==="joinFail"){
    el('joinMsg').textContent = msg.reason || "Join failed";
  }
  else if (msg.t==="message"){
    el('hint').textContent = msg.text;
  }
  else if (msg.t==="roulette"){
    // show roulette overlay
    startRoulette(msg.bullets, (bang)=> {
      ws?.send(JSON.stringify({t:'rouletteResult', bang}));
    });
  }
  else if (msg.t==="gameOver"){
    stopRoulette();
    alert(`Winner: ${msg.winner} / Loser: ${msg.loser}`);
    show('panel-home');
  }
}

function applyState(s){
  roundNo = s.round;
  phase = s.phase;
  el('roundNo').textContent = String(roundNo);
  el('phaseName').textContent = phase;
  el('youName').textContent = s.you.name;
  el('oppName').textContent = s.opp.name;
  el('youHP').textContent = String(s.you.hp);
  el('oppHP').textContent = String(s.opp.hp);
  el('whoBadge').textContent = s.turnNote || "";
  renderCards(s.you.hand, s.board, s.you.exchangeSelectable);
  selectedToExchange.clear();
  updateExchangeLabel();
  if (s.message) el('hint').textContent = s.message;
}

function renderCards(hand, board, selectableIdx){
  const handEl = el('hand'); handEl.innerHTML="";
  hand.forEach((c,idx)=>{
    const d = document.createElement('div');
    d.className = "cardRect";
    d.textContent = fmtCard(c);
    if (selectableIdx?.includes(idx)){
      d.style.borderColor = "#19384d";
      d.style.cursor = "pointer";
      d.onclick = ()=>{
        if (selectedToExchange.has(idx)) selectedToExchange.delete(idx); else {
          if (selectedToExchange.size>=2) return;
          selectedToExchange.add(idx);
        }
        d.style.outline = selectedToExchange.has(idx) ? "2px solid #7fdcff" : "none";
        updateExchangeLabel();
      };
    }
    handEl.appendChild(d);
  });
  const boardEl = el('board'); boardEl.innerHTML="";
  board.forEach(c=>{
    const d = document.createElement('div');
    d.className = "cardRect";
    d.textContent = c ? fmtCard(c) : "🂠";
    boardEl.appendChild(d);
  });
}

function updateExchangeLabel(){
  el('btn-exchange').textContent = `Exchange (${selectedToExchange.size}/2)`;
}

function doExchange(){
  if (selectedToExchange.size===0) return;
  ws?.send(JSON.stringify({t:'exchange', idx:[...selectedToExchange]}));
  selectedToExchange.clear();
  updateExchangeLabel();
}

function fmtCard(c){
  const ranks = "A23456789TJQK";
  const suits = {S:"♠",H:"♥",D:"♦",C:"♣"};
  return c ? (ranks[c[0]] + suits[c[1]]) : "??";
}

/* ---------- Roulette (Canvas) ---------- */
let rw = document.getElementById('rouletteWrap');
let rcv = document.getElementById('roulette');
let rctx = rcv.getContext('2d');
let R_outer=220, slot_r=42, cx=540, cy=860;
let state="SEL"; // SEL->SPIN->RES
let rot=0, rot_start=0, rot_end=0, spin_time=1600, spin_timer=0, extra_turns=4;
let slot_base_angles = Array.from({length:6}, (_,i)=>90 - i*60);
let bullets = new Array(6).fill(false);
let flash_a=0, flash_decay=0.05;
let btn_w=420, btn_h=120; let btn_y=1400; let btn_x1=cx-btn_w/2; let btn_y1=btn_y-btn_h/2; let btn_x2=cx+btn_w/2; let btn_y2=btn_y+btn_h/2;
let result_text="", result_col="#fff";
let pendingCb=null;

function startRoulette(count, cb){
  // initialize bullets randomly with 'count' bullets
  bullets.fill(false);
  let spots=[0,1,2,3,4,5];
  for(let i=0;i<count;i++){
    const k = Math.floor(Math.random()*spots.length);
    bullets[spots[k]] = true; spots.splice(k,1);
  }
  state="SPIN"; rot_start=rot; spin_timer=0;
  const spin_target_index = Math.floor(Math.random()*6);
  const base_target_rot = 270 - slot_base_angles[spin_target_index];
  rot_end = base_target_rot - 360*extra_turns;
  while (rot_end >= rot_start - 120){ rot_end -= 360; }
  rw.style.display = "flex";
  pendingCb = cb;
  requestAnimationFrame(rStep);
}

function stopRoulette(){
  rw.style.display = "none";
}

function rStep(now){
  rUpdate(16);
  rDraw();
  if (rw.style.display!=="none") requestAnimationFrame(rStep);
}

function rUpdate(dt){
  if (state==="SPIN"){
    spin_timer+=dt;
    const t = Math.min(1, spin_timer / spin_time);
    const ease = 1-Math.pow(1-t,3);
    rot = rot_start + (rot_end-rot_start)*ease;
    if (t>=1){
      state="RES"; 
      // check hit slot
      let best_i=0,best_abs=9999;
      for(let i=0;i<6;i++){
        const ang = slot_base_angles[i]+rot;
        let diff = ((ang-270+540)%360)-180; diff=Math.abs(diff);
        if (diff<best_abs){ best_abs=diff; best_i=i; }
      }
      const bang = !!bullets[best_i];
      if (bang){
        // snap
        const cur = slot_base_angles[best_i]+rot;
        let need = ((270-cur+540)%360)-180;
        rot+=need; bullets.fill(false);
        flash_a=1; result_text="BANG!"; result_col="#FF3B30";
      }else{
        result_text="SAFE"; result_col="#00C882";
      }
      setTimeout(()=>{
        // callback to server
        if (pendingCb) pendingCb(result_text==="BANG!");
      }, 400);
      setTimeout(stopRoulette, 900);
    }
  }else if (state==="RES"){
    if (flash_a>0){ flash_a=Math.max(0,flash_a-flash_decay); }
  }
}

function rDraw(){
  rctx.fillStyle="#000"; rctx.fillRect(0,0,1080,1920);
  // ring
  rctx.strokeStyle="#505050"; rctx.lineWidth=1;
  const orn_r=310, orn_count=48, orn_dot_r=6;
  for(let k=0;k<orn_count;k++){
    const a=(k*(360/orn_count))+rot*0.25;
    const x=cx+Math.cos(a*Math.PI/180)*orn_r;
    const y=cy-Math.sin(a*Math.PI/180)*orn_r;
    rctx.beginPath(); rctx.arc(x,y,orn_dot_r,0,Math.PI*2); rctx.stroke();
  }
  // slots
  for(let i=0;i<6;i++){
    const ang=slot_base_angles[i]+rot;
    const sx=cx+Math.cos(ang*Math.PI/180)*R_outer;
    const sy=cy-Math.sin(ang*Math.PI/180)*R_outer;
    rctx.strokeStyle="#fff"; rctx.lineWidth=2;
    rctx.beginPath(); rctx.arc(sx,sy,slot_r,0,Math.PI*2); rctx.stroke();
  }
  // pointer
  const tri_len=42, tri_halfW=26, tri_gap=12, tri_offset_top=90;
  const tip_x=cx; const tip_y=cy-(R_outer+tri_gap+tri_offset_top); const base_y=tip_y-tri_len;
  rctx.strokeStyle="#fff"; rctx.lineWidth=2;
  rctx.beginPath(); rctx.moveTo(tip_x,tip_y); rctx.lineTo(tip_x-tri_halfW,base_y); rctx.lineTo(tip_x+tri_halfW,base_y); rctx.closePath(); rctx.stroke();
  // result text
  if (state!=="SEL"){
    rctx.fillStyle=result_col; rctx.font="bold 60px system-ui"; rctx.textAlign="center"; rctx.textBaseline="middle";
    rctx.fillText(result_text, cx, cy+(R_outer+120));
  }
  if (flash_a>0){
    rctx.save(); rctx.globalAlpha = flash_a*0.8; rctx.fillStyle="#FF3B30"; rctx.fillRect(0,0,1080,1920); rctx.restore();
  }
}

/* ---------- End Roulette ---------- */
