const CACHE_NAME = 'holdemshot-v1';

// 프로젝트 페이지(/user/repo)에서도 잘 동작하도록 BASE 경로 계산
const ORIGIN = self.location.origin;
const SCOPE = self.registration.scope;            // e.g., https://user.github.io/repo/
const BASE = SCOPE.substring(ORIGIN.length).replace(/\/$/,''); // e.g., /repo

const ASSETS = [
  `${BASE}/`,
  `${BASE}/index.html`,
  `${BASE}/client.js`,
  `${BASE}/manifest.json`,
  `${BASE}/icons/icon-192.png`,
  `${BASE}/icons/icon-512.png`
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE_NAME).then(c=>c.addAll(ASSETS)));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k=>k!==CACHE_NAME).map(k=>caches.delete(k)))
    )
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // 동일 오리진만 캐시 우선
  if (url.origin === ORIGIN) {
    e.respondWith(
      caches.match(e.request).then(r =>
        r || fetch(e.request).catch(() => caches.match(`${BASE}/index.html`))
      )
    );
  }
});
