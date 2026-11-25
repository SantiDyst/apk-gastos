const CACHE_NAME = 'apk-gastos-v4.0.0';
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './css/styles.css',
  './js/app.js',
  './js/config.js',
  './js/storage.js',
  './js/backup.js',
  './js/drive-sync.js',
  './js/ui.js',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  'https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css',
  'https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js'
];
const CACHEABLE_ORIGINS = ['https://cdn.jsdelivr.net'];
const GOOGLE_HOSTS = ['googleapis.com', 'accounts.google.com', 'gstatic.com', 'google.com'];

function isGoogleRequest(url) {
  return GOOGLE_HOSTS.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`));
}

function isOwnCache(key) {
  return key.startsWith('apk-gastos-') || key.startsWith('finanzas-');
}

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => isOwnCache(key) && key !== CACHE_NAME)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

async function networkFirstNavigation(request) {
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put('./index.html', response.clone());
    }
    return response;
  } catch (error) {
    const cached = await caches.match('./index.html');
    if (cached) return cached;
    throw error;
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response && response.ok && (request.url.startsWith(self.location.origin) || CACHEABLE_ORIGINS.some((origin) => request.url.startsWith(origin)))) {
    const cache = await caches.open(CACHE_NAME);
    cache.put(request, response.clone());
  }
  return response;
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (isGoogleRequest(url)) return;
  if (url.origin !== self.location.origin && !CACHEABLE_ORIGINS.includes(url.origin)) return;
  if (request.mode === 'navigate') {
    event.respondWith(networkFirstNavigation(request));
    return;
  }
  event.respondWith(cacheFirst(request));
});
