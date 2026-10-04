// Service worker: it makes the site installable and lets the page itself open without a
// connection. The calendar's data still needs the internet; this only keeps the shell.
//
// It always asks the network first and only falls back to the saved copy when that fails,
// so a new version of the site shows up straight away and is never held back by an old cache.
//
// "Asks the network" has to mean asking the server, not the browser's own HTTP cache: GitHub
// Pages marks every file "max-age=600", so a plain fetch() could hand back a copy up to ten
// minutes old after a new version went out. `cache: 'no-cache'` revalidates every time (a tiny
// "has it changed?" request that usually answers 304), so a reload always gets the latest.

const CACHE = 'bgn-shell-v3';

const SHELL = [
  './',
  'index.html',
  'help.html',
  'manifest.webmanifest',
  'css/style.css',
  'js/app.js',
  'js/config.js',
  'js/store.js',
  'js/store-local.js',
  'js/store-firebase.js',
  'js/admin.js',
  'js/avatar.js',
  'js/campaigns.js',
  'js/collection.js',
  'js/dates.js',
  'js/games.js',
  'js/hall.js',
  'js/help.js',
  'js/icons.js',
  'js/ics.js',
  'js/mygames.js',
  'js/special.js',
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
    fetch(request, { cache: 'no-cache' })
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
