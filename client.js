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
let inGame = false;
let localMode = false; // offline fallback
let L = null; // local state container when localMode


// UI bindings
const nickname = el('nickname');
const bulletCount = el('bulletCount');
el('btn-play').onclick = startQuick;
el('btn-create').onclick = createRoom;
el('btn-join').onclick = ()=>show('panel-join');
el('btn-retry').onclick = ()=> connectWS(()=>{});
el('btn-back-join').onclick = ()=>show('panel-home');
el('btn-do-join').onclick = ()=> {
  const code = el('joinCode').value.trim().toUpperCase();
  if (!code) return;
  connectWS(()=> ws.send(JSON.stringify({t:"joinRoom", code, name:getName(), bullets:getBullets()})));
};
el('btn-leave-room').onclick = ()=> { ws?.send(JSON.stringify({t:'leaveRoom'})); inGame=false; show('panel-home'); };
el('btn-cancel-connect').onclick = cancelConnecting;

el('btn-ready').onclick = ()=> { if(localMode) localReady(); else ws?.send(JSON.stringify({t:'ready'})); };
el('btn-next').onclick = ()=> { if(localMode) localNext(); else ws?.send(JSON.stringify({t:'next'})); };
el('btn-exchange').onclick = doExchange;
el('btn-resign').onclick = ()=> { if(localMode){ alert('You resigned. AI wins.'); show('panel-home'); localMode=false; inGame=false; } else ws?.send(JSON.stringify({t:'resign'})); };

function getName(){ return nickname.value.trim() || "Player"+Math.floor(Math.random()*999); }
function getBullets(){ return parseInt(bulletCount.value,10); }

function startQuick(){ inGame=false;
  const wsOpen = (ws && ws.readyState===WebSocket.OPEN);
  if (!wsOpen){
    // offline fallback
    startLocalAIGame();
    return;
  }
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

function cancelConnecting(){ inGame=false;
  if (ws) { ws.close(); ws = null; }
  show('panel-home');
}

function setConnIndicator(color){
  const dot = document.getElementById('connIndicator');
  if (dot) dot.style.background = color;
}
function connectWS(onOpen){
  if (ws) try{ws.close()}catch{}
  const proto = (location.protocol === 'https:') ? 'wss' : 'ws';
  const url = (window.HS_SERVER_URL || `${proto}://${location.host}`);
  ws = new WebSocket(url);
  ws.onopen = ()=>{ setConnIndicator('#00c882'); if (onOpen) onOpen(); };
  ws.onmessage = onWS;
  ws.onclose = ()=>{ setConnIndicator('#ff3b30'); console.log("ws closed"); };
  ws.onerror = ()=>{ setConnIndicator('#ff3b30'); };
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
    inGame = true;
    show('panel-game');
  }
  else if (msg.t==="state"){
    applyState(msg.state);
    if (!inGame) { inGame = true; show('panel-game'); }
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
  if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
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
  if(localMode){ localExchange([...selectedToExchange]); }
  else ws?.send(JSON.stringify({t:'exchange', idx:[...selectedToExchange]}));
  selectedToExchange.clear();
  updateExchangeLabel();
}

function fmtCard(c){
  // Robust formatter: accepts 'AS','10D','JK', ['A','S'], {r:'A',s:'S'}
  if (!c) return "??";
  if (typeof c !== 'string'){
    if (Array.isArray(c) && c.length>=2) c = String(c[0]) + String(c[1]);
    else if (typeof c === 'object' && c !== null && ('r' in c || 'rank' in c)){
      const r = (c.r || c.rank || '').toString();
      const s = (c.s || c.suit || '').toString();
      c = r + s;
    } else {
      return "??";
    }
  }
  c = c.toUpperCase();
  if (c === 'JK') return '🃏';
  let rank, suit;
  if (c.startsWith('10')) { rank = '10'; suit = c[2]; }
  else { rank = c[0]; suit = c[1]; }
  const suits = {S:'♠', H:'♥', D:'♦', C:'♣'};
  if (!rank || !suit || !suits[suit]) return "??";
  return `${rank}${suits[suit]}`;
}

/* ---------- Keep-Alive (Render Free) ---------- */
// 1) Ping over WebSocket when connected
setInterval(()=>{
  if (ws && ws.readyState === WebSocket.OPEN) {
    try{ ws.send(JSON.stringify({t:'ping'})); }catch{}
  }
}, 20000); // every 20s
// 2) Optional HTTP keep-warm (if HS_SERVER_URL points to Render)
(function(){
  const raw = (window.HS_SERVER_URL || '');
  if (!raw) return;
  try{
    const httpURL = raw.replace(/^wss:/,'https:').replace(/^ws:/,'http:');
    setInterval(()=>{
      fetch(httpURL, {mode:'no-cors'}).catch(()=>{});
    }, 60000); // every 60s
  }catch{}
})();

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

/* ---------- Local Offline Mode (fallback vs AI) ---------- */
function startLocalAIGame(){
  localMode = true; inGame = true;
  // init local state
  L = {
    round: 0,
    bullets: getBullets(),
    deck: [],
    hands: {},
    board: [null,null,null,null,null],
    ready: {},
    exchangeCount: {},
    message: ""
  };
  L.youId = 1; L.aiId = 2;
  L.names = {}; L.names[L.youId]=getName(); L.names[L.aiId]=randAIName();
  localStartRound();
  show('panel-game');
  setConnIndicator('#ff3b30'); // amber to indicate local/offline mode
  el('hint').textContent = '오프라인(AI) 모드: 서버 없이 진행 중';
}

function localStartRound(){
  L.round += 1;
  L.deck = freshDeck(); shuffle(L.deck);
  L.board = [null,null,null,null,null];
  L.hands[L.youId] = [drawLocal(), drawLocal()];
  L.hands[L.aiId]  = [drawLocal(), drawLocal()];
  L.ready[L.youId]=false; L.ready[L.aiId]=false;
  L.exchangeCount[L.youId]=0; L.exchangeCount[L.aiId]=0;
  L.message = "카드 배분 완료. 둘 다 Ready → Flop";
  pushLocalState();
}

function pushLocalState(){
  const s = {
    round: L.round,
    phase: L.phase || 'Deal',
    board: L.board.slice(),
    you: { name: L.names[L.youId], hp: 1, hand: L.hands[L.youId].slice(), exchangeSelectable: [0,1] },
    opp:  { name: L.names[L.aiId], hp: 1, hand: ["??","??"], exchangeSelectable: []},
    turnNote: "",
    message: L.message
  };
  applyState(s);
}

function localReady(){
  if (!localMode) return;
  if (!L.phase || L.phase==='Deal'){
    L.phase='Flop'; L.board[0]=drawLocal(); L.board[1]=drawLocal(); L.board[2]=drawLocal();
    L.message = "Flop 공개. 각자 0~2장 교환 가능 → Ready면 Turn";
    // AI exchange randomly 0~2
    localAIExchange();
    pushLocalState();
  } else if (L.phase==='Flop'){
    L.phase='Turn'; L.board[3]=drawLocal(); L.message="Turn 공개. 교환 가능 → Ready면 River"; localAIExchange(); pushLocalState();
  } else if (L.phase==='Turn'){
    L.phase='River'; L.board[4]=drawLocal(); L.message="River 공개. 마지막 교환 → Ready면 Showdown"; localAIExchange(); pushLocalState();
  } else if (L.phase==='River'){
    L.phase='Showdown';
    const ra = bestRankLocal(L.hands[L.youId], L.board);
    const rb = bestRankLocal(L.hands[L.aiId], L.board);
    let winner=null, loser=null, tie=false;
    const cmp = compareRankLocal(ra, rb);
    if (cmp>0){ winner=L.youId; loser=L.aiId; } else if (cmp<0){ winner=L.aiId; loser=L.youId; } else tie=true;
    let msg = `Showdown: ${L.names[L.youId]} ${ra.name} vs ${L.names[L.aiId]} ${rb.name}`;
    if (tie){
      L.message = msg + " → 무승부, 다음 라운드"; pushLocalState(); setTimeout(localStartRound, 600);
    } else {
      L.message = msg + ` → ${L.names[winner]} 승리. 패자는 러시안룰렛`; pushLocalState();
      // Joker effects
      const loserHasJ = hasJokerLocal(L.hands[loser], L.board);
      const winnerHasJ = hasJokerLocal(L.hands[winner], L.board);
      let bullets = L.bullets;
      if (loserHasJ){ el('hint').textContent = `${L.names[loser]} Joker: 러시안룰렛 면제`; setTimeout(localStartRound, 600); return; }
      if (winnerHasJ){ bullets += 1; el('hint').textContent = `${L.names[winner]} Joker: 상대 총알 +1`; }
      startRoulette(bullets, (bang)=>{
        if (bang){
          alert(`Winner: ${L.names[winner]} / Loser: ${L.names[loser]}`);
          show('panel-home'); localMode=false; inGame=false;
        } else {
          localStartRound();
        }
      });
    }
  }
}

function localNext(){ localReady(); }

function localExchange(indexes){
  if (!localMode) return;
  const you = L.youId;
  if (!L.phase || L.phase==='Deal') return;
  if (L.exchangeCount[you]>=2) return;
  const allow = Math.min(2 - L.exchangeCount[you], indexes.length);
  for (let i=0;i<allow;i++){
    const idx = indexes[i];
    if (idx===0 || idx===1){ L.hands[you][idx] = drawLocal(); L.exchangeCount[you]++; }
  }
  L.message = `${L.names[you]}: exchanged ${allow}`;
  pushLocalState();
}

function localAIExchange(){
  const ai = L.aiId;
  const k = Math.floor(Math.random()*3);
  for (let i=0;i<k && L.exchangeCount[ai]<2;i++){
    const idx = (Math.random()<.5?0:1);
    L.hands[ai][idx] = drawLocal();
    L.exchangeCount[ai]++;
  }
}

/* ---- Local helpers (deck/rank) ---- */
function freshDeck(){ const suits=['S','H','D','C']; const ranks=['A','2','3','4','5','6','7','8','9','T','J','Q','K']; const d=[]; for(const s of suits) for(const r of ranks) d.push(r+s); d.push('JK'); d.push('JK'); return d; }
function shuffle(a){ for(let i=a.length-1;i>0;i--){ const j=(Math.random()*(i+1))|0; [a[i],a[j]]=[a[j],a[i]]; } }
function drawLocal(){ return L.deck.pop(); }
function hasJokerLocal(hand, board){ return [...hand, ...board.filter(Boolean)].includes('JK'); }
function randAIName(){ const pool=['CobaltBot','NeonQueen','PaperTiger','SilentJack','K-Dealer','Ghost512','LunaAI','Maverick','Golem','Basilisk']; return pool[(Math.random()*pool.length)|0]; }

const RMAPL = {'A':14,'K':13,'Q':12,'J':11,'T':10,'9':9,'8':8,'7':7,'6':6,'5':5,'4':4,'3':3,'2':2};
function bestRankLocal(hand, board){
  const cards = [...hand, ...board.filter(Boolean)].filter(c=>c!=='JK');
  let best=null; const n=cards.length;
  function choose5(s,p){ if (p.length===5){ const r=rank5Local(p); if(!best || compareRankLocal(r,best)>0) best=r; return; } for(let i=s;i<n;i++) choose5(i+1, p.concat(cards[i])); }
  choose5(0, []); return best || rank5Local(cards.slice(0,5));
}
function compareRankLocal(a,b){ for(let i=0;i<Math.max(a.val.length,b.val.length);i++){ const va=a.val[i]||0, vb=b.val[i]||0; if(va!==vb) return va-vb; } return 0; }
function rank5Local(cards){
  const ranks = cards.map(c=>RMAPL[c[0]]).sort((a,b)=>b-a);
  const suits = cards.map(c=>c[1]);
  const counts = new Map(); ranks.forEach(r=>counts.set(r,(counts.get(r)||0)+1));
  const byCount = [...counts.entries()].sort((a,b)=>(b[1]-a[1])||(b[0]-a[0]));
  const isFlush = suits.every(s=>s===suits[0]);
  const rset = new Set(ranks);
  let isStraight=false, top=0;
  for(let hi=14;hi>=5;hi--){ const seq=[hi,hi-1,hi-2,hi-3,hi-4]; if (seq.every(x=>rset.has(x))){ isStraight=true; top=hi; break; } }
  if (!isStraight && [14,5,4,3,2].every(x=>rset.has(x))){ isStraight=true; top=5; }
  if (isStraight && isFlush) return {name:'Straight Flush', val:[8,top]};
  if (byCount[0][1]===4) return {name:'Four of a Kind', val:[7,byCount[0][0],byCount[1][0]]};
  if (byCount[0][1]===3 && byCount[1][1]===2) return {name:'Full House', val:[6,byCount[0][0],byCount[1][0]]};
  if (isFlush) return {name:'Flush', val:[5, ...ranks]};
  if (isStraight) return {name:'Straight', val:[4, top]};
  if (byCount[0][1]===3){ const ks=ranks.filter(r=>r!==byCount[0][0]); return {name:'Three of a Kind', val:[3, byCount[0][0], ...ks]}; }
  if (byCount[0][1]===2 && byCount[1][1]===2){ const hi=Math.max(byCount[0][0],byCount[1][0]); const lo=Math.min(byCount[0][0],byCount[1][0]); const k=ranks.find(r=>r!==hi && r!==lo); return {name:'Two Pair', val:[2,hi,lo,k||0]}; }
  if (byCount[0][1]===2){ const p=byCount[0][0]; const ks=ranks.filter(r=>r!==p); return {name:'One Pair', val:[1,p,...ks]}; }
  return {name:'High Card', val:[0, ...ranks]};
}
