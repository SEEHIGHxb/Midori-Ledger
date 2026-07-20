/**
 * Midori — Premium Finance Ledger App
 * sw-register.js: Service Worker registration.
 *
 * Extracted from an inline <script> in index.html so the page can ship a
 * Content-Security-Policy without 'unsafe-inline' in script-src — which is the
 * directive that actually stops an injected <script> from running.
 */
if ('serviceWorker' in navigator) {
  // Whether this page load was already under service-worker control. If it was
  // not, the very first 'controllerchange' is just the initial worker claiming
  // the page — reloading on that would bounce every first-time visitor.
  const wasControlledAtLoad = Boolean(navigator.serviceWorker.controller);

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js')
      .then((reg) => {
        console.log('Midori Service Worker registered successfully:', reg.scope);

        reg.onupdatefound = () => {
          const installingWorker = reg.installing;
          if (!installingWorker) return;
          installingWorker.onstatechange = () => {
            if (installingWorker.state === 'installed' && navigator.serviceWorker.controller) {
              console.log('New Midori version detected. Upgrading in background...');
            }
          };
        };
      })
      .catch((err) => console.error('Midori Service Worker registration failed:', err));
  });

  // Reload once when a NEW worker takes over an already-controlled page, so the
  // user lands on the updated assets rather than a half-old shell.
  let refreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!wasControlledAtLoad || refreshing) return;
    refreshing = true;
    console.log('New Service Worker active. Reloading page to apply updates...');
    window.location.reload();
  });
}
