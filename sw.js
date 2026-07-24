/**
 * Midori — Premium Finance Ledger
 * sw.js: Service Worker for complete offline capabilities
 */

const CACHE_NAME = 'midori-cache-v29';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './manifest.json',
  './css/style.css',
  // Self-hosted so the UI keeps its typography offline; the old CDN <link> was
  // cross-origin, which the fetch handler skips, so fonts never cached.
  './css/fonts.css',
  './fonts/inter-latin.woff2',
  './fonts/outfit-latin.woff2',
  './js/merge.js',
  './js/state.js',
  './js/scheduler.js',
  './js/ml-features.js',
  './js/ml-core.js',
  './js/ml-forecast.js',
  './js/ml-subscriptions.js',
  './js/ml-budget.js',
  './js/charts.js',
  './js/dashboard.js',
  './js/insights.js',
  './js/wallets.js',
  './js/categories-budgets.js',
  './js/transactions.js',
  './js/schedules.js',
  './js/sync.js',
  './js/supabase-config.js',
  './js/supabase-sync.js',
  './js/ui-core.js',
  './js/sw-register.js',
  // Vendored so charts still render with no network. While this was a CDN tag
  // the fetch handler skipped it (cross-origin) and the dashboard came up blank offline.
  './js/chart.umd.min.js',
  './image/midori.png'
];

// Install Event
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[Service Worker] Caching core assets');
      // cache: 'reload' forces each precache fetch past the browser's own HTTP
      // cache. Without it addAll() happily stores whatever the HTTP cache is
      // already holding, so a freshly-installed worker can precache the very
      // assets it was bumped to replace — bumping CACHE_NAME then looks like it
      // shipped an update while every user keeps running the old JS. Observed
      // directly: a v16 install cached a 19,075-byte ui-core.js while the
      // server was serving 21,958 bytes.
      return cache.addAll(
        ASSETS_TO_CACHE.map((url) => new Request(url, { cache: 'reload' }))
      );
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

function cachePut(request, response) {
  const copy = response.clone();
  caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
}

// Fetch Event — network-first for navigations, cache-first for static assets
self.addEventListener('fetch', (event) => {
  const request = event.request;

  // cache.put() throws on a non-GET request, and the FX/sync POSTs must reach
  // the network untouched, so only same-origin GETs are handled here. Anything
  // else (cross-origin, chrome-extension://, file://) falls through to the
  // browser's default handling.
  if (request.method !== 'GET') return;
  if (!request.url.startsWith(self.location.origin)) return;

  // Navigations go network-first. Cache-first pinned each user to whichever
  // index.html they happened to install: a shipped fix only reached them if
  // CACHE_NAME was also bumped, a manual step that is easy to forget and that
  // silently strands everyone who already has the app. Falling back to the
  // cache keeps the app fully usable offline.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            cachePut(request, networkResponse);
          }
          return networkResponse;
        })
        .catch(() => caches.match(request).then((cached) => cached || caches.match('./index.html')))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }

      return fetch(request)
        .then((networkResponse) => {
          // If response is valid, cache a clone of it
          if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
            cachePut(request, networkResponse);
          }
          return networkResponse;
        })
        .catch(() => {
          // Returning undefined here made respondWith reject, which the page
          // saw as an unexplained network error. An explicit 504 at least
          // names the cause.
          console.warn('[Service Worker] Offline and not cached:', request.url);
          return new Response('', { status: 504, statusText: 'Offline' });
        });
    })
  );
});
