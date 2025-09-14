
// Same-origin API (server serves PWA + API together)
const API_BASE = '';

const els = {
  nickname: document.getElementById('nickname'),
  dot: document.getElementById('dot'),
  srvText: document.getElementById('srvText'),
  btnRetry: document.getElementById('btnRetry'),
  btnPlay: document.getElementById('btnPlay'),
  btnCreate: document.getElementById('btnCreate'),
  btnJoin: document.getElementById('btnJoin'),
  roomCode: document.getElementById('roomCode'),
  connecting: document.getElementById('connecting'),
};

// Persist nickname
els.nickname.value = localStorage.getItem('hs_nickname') || '';
els.nickname.addEventListener('input', e => localStorage.setItem('hs_nickname', e.target.value.trim()));

function setStatus(connected, label){
  els.dot.classList.remove('ok','bad');
  els.dot.classList.add(connected?'ok':'bad');
  els.srvText.textContent = label;
}

function withTimeout(ms, p){
  return new Promise((resolve,reject)=>{
    const t = setTimeout(()=>reject(new Error('timeout')), ms);
    p.then(v=>{clearTimeout(t);resolve(v)}).catch(e=>{clearTimeout(t);reject(e)});
  });
}

async function checkServer(){
  if (!navigator.onLine){ setStatus(false,'Offline'); return false; }
  try{
    const res = await withTimeout(3000, fetch(`${API_BASE}/health`, {cache:'no-store'}));
    const ok = res.ok; setStatus(ok, ok?'Connected':'Error'); return ok;
  }catch(e){ setStatus(false,'Unreachable'); return false; }
}

async function quickMatch(){
  const name = (els.nickname.value || 'Guest').slice(0,18);
  els.connecting.classList.remove('hidden');
  const canServer = await checkServer();
  if (!canServer){ startAIMatch(name); return; }

  let matched = false;
  const abort = new AbortController();
  const timer = setTimeout(()=>{ abort.abort(); if(!matched) startAIMatch(name); }, 8000);

  try{
    const res = await withTimeout(8000, fetch(`${API_BASE}/matchmake`, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ nickname: name }), signal: abort.signal
    }));
    const data = await res.json();
    matched = true; clearTimeout(timer);
    if (data.ai){ startAIMatch(name); return; }
    location.href = `./play.html?room=${encodeURIComponent(data.roomId)}&code=${encodeURIComponent(data.code)}`;
  }catch(e){
    if(!matched) startAIMatch(name);
  }
}

function startAIMatch(name){
  els.connecting.classList.add('hidden');
  alert(`AI 모드로 시작합니다.\n닉네임: ${name}`);
  location.href = './play.html?mode=ai';
}

async function createRoom(){
  const canServer = await checkServer(); if(!canServer) return alert('서버에 연결할 수 없습니다.');
  try{
    const res = await withTimeout(5000, fetch(`${API_BASE}/rooms`, {method:'POST'}));
    const data = await res.json();
    prompt('방 코드가 발급되었습니다. 공유하세요:', data.code || 'A1B2C3');
  }catch(e){ alert('방 생성 중 오류가 발생했습니다.'); }
}

async function joinRoom(){
  const code = (els.roomCode.value||'').trim().toUpperCase();
  if(!code) return alert('방 코드를 입력하세요.');
  const canServer = await checkServer(); if(!canServer) return alert('서버에 연결할 수 없습니다.');
  try{
    const res = await withTimeout(5000, fetch(`${API_BASE}/rooms/${encodeURIComponent(code)}/join`, {method:'POST'}));
    if(res.ok){
      const data = await res.json();
      location.href = `./play.html?room=${encodeURIComponent(data.roomId)}&code=${encodeURIComponent(code)}`;
    } else { alert('방 입장에 실패했습니다. 코드가 올바른지 확인하세요.'); }
  }catch(e){ alert('방 입장 중 오류가 발생했습니다.'); }
}

els.btnRetry.addEventListener('click', checkServer);
els.btnPlay.addEventListener('click', quickMatch);
els.btnCreate.addEventListener('click', createRoom);
els.btnJoin.addEventListener('click', joinRoom);

checkServer();
window.addEventListener('online', checkServer);
window.addEventListener('offline', ()=>setStatus(false,'Offline'));
