
/**
 * Hold’em & SHOT – PWA bootstrap
 * - Server health check with timeout
 * - Quick Match with 8s failover to AI
 * - Create/Join stubs (wire to your backend)
 * - Offline-first hints
 */

const API_BASE = (location.hostname === 'localhost')
  ? 'http://localhost:8080'  // dev
  : 'https://your-render-app.onrender.com'; // TODO: replace with your Render URL

const els = {
  nickname: document.getElementById('nickname'),
  statusWrap: document.getElementById('srvStatus'),
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
els.nickname.addEventListener('input', e => {
  localStorage.setItem('hs_nickname', e.target.value.trim());
});

function withTimeout(ms, promise) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then(v => { clearTimeout(t); resolve(v); })
           .catch(e => { clearTimeout(t); reject(e); });
  });
}

async function checkServer() {
  // Prefer network if online, otherwise mark offline immediately
  if (!navigator.onLine) {
    setStatus(false, 'Offline');
    return false;
  }
  try {
    const res = await withTimeout(3000, fetch(`${API_BASE}/health`, { cache: 'no-store' }));
    const ok = res.ok;
    setStatus(ok, ok ? 'Connected' : 'Error');
    return ok;
  } catch (e) {
    setStatus(false, 'Unreachable');
    return false;
  }
}

function setStatus(connected, label) {
  els.dot.classList.remove('ok', 'bad');
  els.dot.classList.add(connected ? 'ok' : 'bad');
  els.srvText.textContent = label;
}

async function quickMatch() {
  const name = (els.nickname.value || 'Guest').slice(0, 18);
  els.connecting.classList.remove('hidden');

  const canServer = await checkServer();
  if (!canServer) {
    // Offline → AI mode immediately
    startAIMatch(name);
    return;
  }

  // Try server match. If 8s no match → AI fallback.
  let matched = false;
  const abort = new AbortController();
  const timer = setTimeout(() => {
    abort.abort();
    if (!matched) startAIMatch(name);
  }, 8000);

  try {
    const res = await withTimeout(8000, fetch(`${API_BASE}/matchmake`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nickname: name }),
      signal: abort.signal,
    }));
    if (res.ok) {
      matched = true;
      clearTimeout(timer);
      const data = await res.json().catch(() => ({}));
      // Redirect to your game route/room with data.roomId etc.
      location.href = `./play.html?room=${encodeURIComponent(data.roomId || 'server')}`;
      return;
    }
  } catch (e) {
    // swallow
  }
  // If we got here without redirect, AI fallback
  if (!matched) startAIMatch(name);
}

function startAIMatch(name) {
  els.connecting.classList.add('hidden');
  // In real app, navigate to your single-player scene
  alert(`AI 모드로 시작합니다.\n닉네임: ${name}`);
  location.href = './play.html?mode=ai';
}

async function createRoom() {
  const canServer = await checkServer();
  if (!canServer) return alert('서버에 연결할 수 없습니다. 오프라인에서는 방 생성이 불가합니다.');
  try {
    const res = await withTimeout(5000, fetch(`${API_BASE}/rooms`, { method: 'POST' }));
    const data = await res.json();
    const code = data.code || 'A1B2C3';
    prompt('방 코드가 발급되었습니다. 공유하세요:', code);
  } catch (e) {
    alert('방 생성 중 오류가 발생했습니다.');
  }
}

async function joinRoom() {
  const code = (els.roomCode.value || '').trim().toUpperCase();
  if (!code) return alert('방 코드를 입력하세요.');
  const canServer = await checkServer();
  if (!canServer) return alert('서버에 연결할 수 없습니다.');
  try {
    const res = await withTimeout(5000, fetch(`${API_BASE}/rooms/${encodeURIComponent(code)}/join`, { method: 'POST' }));
    if (res.ok) {
      location.href = `./play.html?room=${encodeURIComponent(code)}`;
    } else {
      alert('방 입장에 실패했습니다. 코드가 올바른지 확인하세요.');
    }
  } catch (e) {
    alert('방 입장 중 오류가 발생했습니다.');
  }
}

// Wire UI
els.btnRetry.addEventListener('click', checkServer);
els.btnPlay.addEventListener('click', quickMatch);
els.btnCreate.addEventListener('click', createRoom);
els.btnJoin.addEventListener('click', joinRoom);

// Initial
checkServer();
// Re-check on connectivity changes
window.addEventListener('online', checkServer);
window.addEventListener('offline', () => setStatus(false, 'Offline'));
