const CACHE_NAME = 'holdemshot-v2';
const ORIGIN = self.location.origin;
const SCOPE = self.registration.scope;
const BASE = SCOPE.substring(ORIGIN.length).replace(/\/$/,'');
const ASSETS = [
  `${BASE}/`,
  `${BASE}/index.html`,
  `${BASE}/client.js`,
  `${BASE}/manifest.json`,
  `${BASE}/icons/icon-192.png`,
  `${BASE}/icons/icon-512.png`
];

self.addEventListener('install', e=>{
  e.waitUntil(caches.open(CACHE_NAME).then(c=>c.addAll(ASSETS)));
});
self.addEventListener('activate', e=>{
  e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE_NAME).map(k=>caches.delete(k)))));
});
self.addEventListener('fetch', e=>{
  const url = new URL(e.request.url);
  if (url.origin===ORIGIN){
    e.respondWith(caches.match(e.request).then(r=> r || fetch(e.request).catch(()=>caches.match(`${BASE}/index.html`))));
  }
});
