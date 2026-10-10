/**
 * sw.js — Stitchee service worker.
 *
 * Goal: make the app installable and usable offline, on BOTH builds, without a
 * brittle precache list (Flask serves assets from /static/, the GitHub Pages
 * build serves them from the site root, so a hardcoded manifest of URLs would
 * only ever be right for one of them).
 *
 * Strategy:
 *   • Navigations   → network-first, falling back to the cached shell offline.
 *   • Static assets → network-first too, falling back to cache when offline.
 *                     (Stale-while-revalidate was tried first and served a
 *                     ONE-VERSION-OLD script on the first reload after a deploy,
 *                     because the site has no cache-busted asset URLs on the
 *                     Flask build. Freshness wins: everything still works
 *                     offline because each response is cached on first use.)
 *   • /api/*        → never touched (never cached), so data stays live.
 *
 * Assets are cache-busted per deploy in the static build (style.css?v=<sha>),
 * and revalidated by etag on the Flask build.
 */
'use strict';

const CACHE = 'stitchee-v2';
// Precached only as an offline fallback; the rest is cached on first use.
const CORE = ['./', './manifest.webmanifest'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(CORE))
      .catch(() => {})
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  let url;
  try {
    url = new URL(req.url);
  } catch (e) {
    return;
  }
  if (url.origin !== self.location.origin) return; // cross-origin: leave alone
  if (url.pathname.indexOf('/api/') === 0) return; // live data: never cache

  // Page loads: fresh when online, cached shell when offline.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((resp) => {
          if (resp && resp.ok) put(req, resp.clone());
          return resp;
        })
        .catch(() =>
          caches.match(req).then((hit) => hit || caches.match('./')),
        ),
    );
    return;
  }

  // Static assets: fresh when online, cached copy when offline.
  event.respondWith(
    fetch(req)
      .then((resp) => {
        if (resp && resp.ok && resp.type === 'basic') put(req, resp.clone());
        return resp;
      })
      .catch(() => caches.match(req)),
  );
});

function put(req, resp) {
  caches.open(CACHE).then((cache) => cache.put(req, resp)).catch(() => {});
}
