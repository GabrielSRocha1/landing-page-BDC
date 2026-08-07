/* ══════════ BODE COIN — SERVICE WORKER ══════════
   Estratégias:
   - navegação (HTML): network-first, com fallback para o shell em cache (offline)
   - assets próprios (imagens/ícones/manifest): stale-while-revalidate
   - Google Fonts: stale-while-revalidate
   Ao publicar uma nova versão, altere VERSION para invalidar os caches antigos.
*/

const VERSION = 'v1.2.0';
const CORE_CACHE = 'bdc-core-' + VERSION;
const RUNTIME_CACHE = 'bdc-runtime-' + VERSION;

// Shell mínimo — o site é uma página única
const CORE_ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-192.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon-32.png',
  './icons/favicon-16.png'
];

const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CORE_CACHE);
    // add() individual: um asset ausente não derruba a instalação inteira
    await Promise.all(CORE_ASSETS.map((url) => cache.add(url).catch(() => {})));
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys.filter((k) => k.startsWith('bdc-') && k !== CORE_CACHE && k !== RUNTIME_CACHE)
        .map((k) => caches.delete(k))
    );
    if (self.registration.navigationPreload) {
      await self.registration.navigationPreload.enable();
    }
    await self.clients.claim();
  })());
});

// A página pede a troca imediata quando o usuário aceita atualizar
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

function isCacheable(response) {
  return response && (response.ok || response.type === 'opaque');
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(RUNTIME_CACHE);
  const cached = await caches.match(request);

  const network = fetch(request).then((response) => {
    if (isCacheable(response)) cache.put(request, response.clone());
    return response;
  }).catch(() => null);

  if (cached) return cached;
  const fresh = await network;
  return fresh || Response.error();
}

async function networkFirstNavigation(event) {
  try {
    const preload = event.preloadResponse ? await event.preloadResponse : null;
    const response = preload || await fetch(event.request);
    if (isCacheable(response)) {
      const cache = await caches.open(RUNTIME_CACHE);
      cache.put(event.request, response.clone());
    }
    return response;
  } catch (err) {
    const cached = await caches.match(event.request);
    if (cached) return cached;
    const shell = await caches.match('./index.html') || await caches.match('./');
    if (shell) return shell;
    return new Response('Você está offline.', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' }
    });
  }
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  // Analytics da Vercel: nunca interceptar. O script deve vir sempre da rede
  // (servir uma versão em cache quebraria a coleta) e os beacons precisam
  // chegar ao servidor sem passar pelo cache.
  if (url.pathname.startsWith('/_vercel/')) return;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirstNavigation(event));
    return;
  }

  if (url.origin === self.location.origin || FONT_HOSTS.includes(url.hostname)) {
    event.respondWith(staleWhileRevalidate(request));
  }
});
