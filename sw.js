/**
 * Midori — Premium Finance Ledger
 * sw.js: Service Worker for complete offline capabilities
 */

const CACHE_NAME = 'midori-cache-v12';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './manifest.json',
  './css/style.css',
  './js/state.js',
  './js/scheduler.js',
  './js/charts.js',
  './js/dashboard.js',
  './js/wallets.js',
  './js/categories-budgets.js',
  './js/transactions.js',
  './js/schedules.js',
  './js/sync.js',
  './js/ui-core.js',
  './js/qrcode.min.js',
  './js/jsqr.min.js',
  './image/midori.png'
];

// Install Event
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[Service Worker] Caching core assets');
      return cache.addAll(ASSETS_TO_CACHE);
    }).then(() => self.skipWaiting())
  );
});

// Activate Event
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            console.log('[Service Worker] Clearing old cache:', key);
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch Event (Cache-first with Network Fallback)
self.addEventListener('fetch', (event) => {
  // Only handle standard http/https schemes (avoid chrome-extension:// or file:// requests)
  if (!event.request.url.startsWith(self.location.origin)) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }

      return fetch(event.request)
        .then((networkResponse) => {
          // If response is valid, cache a clone of it
          if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
            const responseToCache = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseToCache);
            });
          }
          return networkResponse;
        })
        .catch(() => {
          // Offline fallback
          console.warn('[Service Worker] Fetch failed, device is offline.');
        });
    })
  );
});
