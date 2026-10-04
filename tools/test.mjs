// Checks for the parts of the site that are plain logic (no browser needed):
//   node tools/test.mjs

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import vm from 'node:vm';
import { buildIcs } from '../js/ics.js';
import { tally, ranked, newestFirst } from '../js/hall.js';

const encoder = new TextEncoder();
const root = new URL('..', import.meta.url);

// ---- the "Add to calendar" file --------------------------------------------------------
{
  const now = new Date(Date.UTC(2026, 9, 4, 12, 0, 0));

  const timed = buildIcs({
    key: '2026-10-09',
    date: new Date(2026, 9, 9),
    place: "Mia's place, Main St 5; 2nd floor",
    time: '19:30',
    description: 'Available: Leo, Mia and Zoe\nTop pick so far: Azul (2 votes)',
    url: 'https://example.test/',
    now,
  });
  assert.ok(timed.startsWith('BEGIN:VCALENDAR\r\n') && timed.endsWith('END:VCALENDAR\r\n'), 'wrapped as a calendar, CRLF line ends');
  assert.ok(timed.includes('DTSTART:20261009T193000\r\n'), 'starts at the given time');
  assert.ok(timed.includes('DTEND:20261009T223000\r\n'), 'lasts three hours by default');
  assert.ok(timed.includes('DTSTAMP:20261004T120000Z\r\n'), 'stamped in UTC');
  assert.ok(timed.includes("LOCATION:Mia's place\\, Main St 5\\; 2nd floor"), 'commas and semicolons are escaped');
  assert.ok(timed.includes('\\nTop pick so far'), 'line breaks in the description are escaped');

  const allDay = buildIcs({ key: '2026-10-31', date: new Date(2026, 9, 31), now });
  assert.ok(allDay.includes('DTSTART;VALUE=DATE:20261031\r\n'), 'no time: an all-day event');
  assert.ok(allDay.includes('DTEND;VALUE=DATE:20261101\r\n'), 'all-day events end on the next day (month rollover)');
  assert.ok(!allDay.includes('LOCATION'), 'no location line when there is no location');

  const newYear = buildIcs({ key: 'x', date: new Date(2026, 11, 31), now });
  assert.ok(newYear.includes('DTEND;VALUE=DATE:20270101'), 'year rollover');

  const badTime = buildIcs({ key: 'x', date: new Date(2026, 9, 9), time: '25:99', now });
  assert.ok(badTime.includes('DTSTART;VALUE=DATE:20261009'), 'an invalid time falls back to all-day');

  const long = buildIcs({ key: 'x', date: new Date(2026, 9, 9), description: 'é'.repeat(80), now });
  for (const line of long.split('\r\n')) {
    assert.ok(encoder.encode(line).length <= 75, `every line is at most 75 bytes (got ${encoder.encode(line).length})`);
  }
  assert.ok(long.replace(/\r\n /g, '').includes(`DESCRIPTION:${'é'.repeat(80)}`), 'folded lines join back up');
  console.log('ok  calendar file');
}

// ---- the hall of fame numbers ----------------------------------------------------------
{
  const plays = [
    { id: 'a', date: '2026-09-13', game: { name: 'Catan' }, winner: 'mia', players: ['mia', 'leo', 'zoe', 'sam'], createdAt: 1 },
    { id: 'b', date: '2026-09-20', game: { name: 'Azul' }, winner: 'leo', players: ['mia', 'leo', 'zoe'], createdAt: 2 },
    { id: 'c', date: '2026-09-20', game: { name: 'Wingspan' }, winner: 'zoe', players: ['mia', 'leo', 'zoe'], createdAt: 3 },
    { id: 'd', date: '2026-09-27', game: { name: 'Pandemic' }, winner: null, players: ['mia', 'leo', 'zoe', 'sam'], createdAt: 4 },
    { id: 'e', date: '2026-09-27', game: { name: '7 Wonders' }, winner: 'mia', players: ['mia', 'leo', 'sam'], createdAt: 5 },
  ];
  const names = { mia: 'Mia', leo: 'Leo', zoe: 'Zoe', sam: 'Sam' };
  const nameOf = (id) => names[id];
  const t = tally(plays);

  assert.equal(t.gameCount, 5, 'five games logged');
  assert.equal(t.nightCount, 3, 'on three different nights');

  assert.deepEqual(
    ranked(t.wins, nameOf).map((r) => [r.id, r.n, r.rank]),
    [['mia', 2, 1], ['leo', 1, 2], ['zoe', 1, 2]],
    'wins: a co-op game with no winner counts for nobody; ties share a rank, ordered by name',
  );
  assert.deepEqual(
    ranked(t.nights, nameOf).map((r) => [r.id, r.n, r.rank]),
    [['leo', 3, 1], ['mia', 3, 1], ['zoe', 3, 1], ['sam', 2, 4]],
    'participation counts nights, not games (a two-game night counts once); ranks 1, 1, 1, 4',
  );
  assert.deepEqual(newestFirst(plays).map((p) => p.id), ['e', 'd', 'c', 'b', 'a'], 'newest night first, then newest log first');
  assert.deepEqual(tally([]), { wins: [], nights: [], nightCount: 0, gameCount: 0 }, 'an empty hall of fame');
  console.log('ok  hall of fame numbers');
}

// ---- the service worker (installable app + offline shell) -----------------------------
// The preview browsers can't always run service workers, so this runs sw.js against a small
// pretend browser instead.
{
  const source = readFileSync(new URL('sw.js', root), 'utf8');

  const handlers = {};
  const stores = new Map();                                  // cache name -> Map(url -> response)
  const base = 'https://site.test/BoardGameNight/';
  const absolute = (u) => new URL(u, base).href.split('?')[0];   // a real cache treats these as one entry
  const cacheApi = (name) => ({
    addAll: async (urls) => { for (const u of urls) stores.get(name).set(absolute(u), { url: u, from: 'install' }); },
    put: async (req, res) => { stores.get(name).set(absolute(req.url), res); },
  });
  const caches = {
    open: async (name) => { if (!stores.has(name)) stores.set(name, new Map()); return cacheApi(name); },
    keys: async () => [...stores.keys()],
    delete: async (name) => stores.delete(name),
    match: async (req) => {
      const url = absolute(typeof req === 'string' ? req : req.url);
      for (const store of stores.values()) if (store.has(url)) return store.get(url);
      return undefined;
    },
  };
  let online = true;
  const sandbox = {
    self: {
      location: { origin: 'https://site.test' },
      addEventListener: (type, fn) => { handlers[type] = fn; },
      skipWaiting: () => { sandbox.skipped = true; },
      clients: { claim: async () => { sandbox.claimed = true; } },
    },
    caches,
    fetch: async (req) => {
      if (!online) throw new TypeError('offline');
      return { ok: true, url: req.url, body: 'fresh', clone() { return { ...this }; } };
    },
    URL,
    console,
  };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox);

  // every file the install step caches has to exist, or the whole install fails
  const shell = vm.runInContext('SHELL', sandbox);
  for (const entry of shell) {
    const file = entry === './' ? 'index.html' : entry;
    assert.ok(existsSync(new URL(file, root)), `cached file exists: ${entry}`);
  }

  const run = async (type, event) => {
    let pending;
    handlers[type]({ ...event, waitUntil: (p) => { pending = p; }, respondWith: (p) => { pending = p; event.responded = true; } });
    return pending;
  };

  // install: caches the shell and takes over straight away
  await run('install', {});
  assert.equal(stores.get('bgn-shell-v1').size, shell.length, 'the whole shell is cached on install');
  assert.ok(sandbox.skipped, 'a new version takes over without waiting');

  // activate: old caches are cleaned up
  stores.set('bgn-shell-v0', new Map());
  await run('activate', {});
  assert.deepEqual([...stores.keys()], ['bgn-shell-v1'], 'old caches are deleted');
  assert.ok(sandbox.claimed, 'open pages are taken over');

  // fetch, online: the fresh network copy wins, and is saved for later
  const page = { url: 'https://site.test/BoardGameNight/css/style.css', method: 'GET' };
  const online1 = await run('fetch', { request: page, responded: false });
  assert.equal(online1.body, 'fresh', 'network first: new versions show up straight away');
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(stores.get('bgn-shell-v1').get(absolute(page.url)).body, 'fresh', 'the fresh copy is saved (replacing the install-time one)');

  // fetch, offline: falls back to the saved copy, ignoring ?demo-style query strings
  online = false;
  const offline1 = await run('fetch', { request: page, responded: false });
  assert.equal(offline1.body, 'fresh', 'offline: the saved copy is used');
  const offlineIndex = await run('fetch', { request: { url: 'https://site.test/BoardGameNight/unknown-page', method: 'GET' }, responded: false });
  assert.ok(offlineIndex, 'offline and not saved: falls back to the app page instead of an error');

  // other sites (fonts, Firebase) and non-GET requests are left alone
  for (const request of [
    { url: 'https://fonts.googleapis.com/css2?family=x', method: 'GET' },
    { url: 'https://site.test/BoardGameNight/css/style.css', method: 'POST' },
  ]) {
    const event = { request, responded: false };
    handlers.fetch({ ...event, respondWith: () => { event.responded = true; } });
    assert.equal(event.responded, false, `not intercepted: ${request.method} ${request.url}`);
  }
  console.log('ok  service worker');
}
