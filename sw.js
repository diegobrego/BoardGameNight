// Service worker: it makes the site installable and lets the page itself open without a
// connection. The calendar's data still needs the internet; this only keeps the shell.
//
// It always asks the network first and only falls back to the saved copy when that fails,
// so a new version of the site shows up straight away and is never held back by an old cache.

const CACHE = 'bgn-shell-v1';

const SHELL = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/style.css',
  'js/app.js',
  'js/config.js',
  'js/store.js',
  'js/store-local.js',
  'js/store-firebase.js',
  'js/avatar.js',
  'js/campaigns.js',
  'js/dates.js',
  'js/games.js',
  'js/hall.js',
  'js/icons.js',
  'js/ics.js',
  'icons/icon-192.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  // Only this site's own files. Fonts, Firebase and everything else go straight to the network.
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(() => caches.match(request, { ignoreSearch: true })
        .then((saved) => saved || caches.match('index.html'))),
  );
});
