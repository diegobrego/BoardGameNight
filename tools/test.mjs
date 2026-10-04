// Checks for the parts of the site that are plain logic (no browser needed):
//   node tools/test.mjs

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import vm from 'node:vm';
import { buildIcs } from '../js/ics.js';
import { tally, ranked, newestFirst, playerStats, awardTitles } from '../js/hall.js';
import { pastDays, upcomingDays } from '../js/dates.js';
import { sessionsOf, plannedOn, campaignRecord, sortCampaigns, defaultTitle, can, outsiders } from '../js/campaigns.js';
import { MAX_MY_GAMES, hasGame, withGame, withoutGame, matchMine } from '../js/mygames.js';
import { voteKey } from '../js/games.js';

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
    fetch: async (req, init) => {
      if (!online) throw new TypeError('offline');
      sandbox.lastInit = init;
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
  assert.equal(stores.get('bgn-shell-v2').size, shell.length, 'the whole shell is cached on install');
  assert.ok(sandbox.skipped, 'a new version takes over without waiting');

  // activate: old caches are cleaned up
  stores.set('bgn-shell-v1', new Map());
  await run('activate', {});
  assert.deepEqual([...stores.keys()], ['bgn-shell-v2'], 'old caches are deleted');
  assert.ok(sandbox.claimed, 'open pages are taken over');

  // fetch, online: the fresh network copy wins, and is saved for later
  const page = { url: 'https://site.test/BoardGameNight/css/style.css', method: 'GET' };
  const online1 = await run('fetch', { request: page, responded: false });
  assert.equal(online1.body, 'fresh', 'network first: new versions show up straight away');
  assert.equal(sandbox.lastInit?.cache, 'no-cache', "it asks the server, not the browser's 10-minute HTTP cache");
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(stores.get('bgn-shell-v2').get(absolute(page.url)).body, 'fresh', 'the fresh copy is saved (replacing the install-time one)');

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

// ---- days: the last week ---------------------------------------------------------------
{
  const sunday = new Date(2026, 9, 4);   // Sunday 4 October 2026
  const past = pastDays(7, sunday);
  assert.deepEqual(
    past.map((d) => d.key),
    ['2026-09-27', '2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03'],
    'the seven days before today, oldest first',
  );
  assert.equal(past[6].dow, 'SAT', 'the last one is yesterday (Saturday)');
  assert.ok(past.every((d) => d.isPast && !d.isToday), 'all marked as past');
  const upcoming = upcomingDays(3, sunday);
  assert.ok(upcoming[0].isToday && !upcoming[0].isPast && upcoming.every((d) => !d.isPast), 'upcoming days are not past');
  assert.equal(pastDays(3, new Date(2026, 2, 2))[0].key, '2026-02-27', 'crosses a month boundary');
  console.log('ok  last week');
}

// ---- player cards ------------------------------------------------------------------------
{
  const game = (id, name) => ({ id, name });
  const plays = [
    { id: 'a', date: '2026-09-13', game: game(13, 'Catan'), winner: 'mia', players: ['mia', 'leo', 'zoe', 'sam'], createdAt: 1 },
    { id: 'b', date: '2026-09-20', game: game(1, 'Azul'), winner: 'leo', players: ['mia', 'leo', 'zoe'], createdAt: 2 },
    { id: 'c', date: '2026-09-20', game: game(2, 'Wingspan'), winner: 'zoe', players: ['mia', 'leo', 'zoe'], createdAt: 3 },
    { id: 'd', date: '2026-09-27', game: game(3, 'Pandemic'), winner: null, players: ['mia', 'leo', 'zoe', 'sam'], createdAt: 4 },
    { id: 'e', date: '2026-09-27', game: game(4, '7 Wonders'), winner: 'mia', players: ['mia', 'leo', 'sam'], createdAt: 5 },
    { id: 'f', date: '2026-10-04', game: game(13, 'Catan'), winner: 'mia', players: ['mia', 'leo', 'zoe', 'sam'], createdAt: 6 },
  ];

  const mia = playerStats(plays, 'mia');
  assert.equal(mia.games, 6, 'six games');
  assert.equal(mia.wins, 3, 'three wins');
  assert.equal(mia.contested, 5, 'five of them had a winner (Pandemic did not)');
  assert.equal(mia.winRate, 0.6, 'win rate ignores games with no winner: 3 of 5');
  assert.equal(mia.nights, 4, 'four different nights');
  assert.deepEqual(mia.favourite, { name: 'Catan', n: 2 }, 'favourite = most played');
  assert.deepEqual(mia.bestAt, { name: 'Catan', n: 2 }, 'best at = most wins in one game');
  assert.deepEqual(mia.recent[0], { date: '2026-10-04', game: 'Catan', result: 'won', campaign: false }, 'newest first');
  assert.equal(mia.recent.length, 5, 'at most five recent games');

  const sam = playerStats(plays, 'sam');
  assert.equal(sam.wins, 0);
  assert.equal(sam.bestAt, null, 'no wins, so no "best at"');
  assert.deepEqual(playerStats(plays, 'nobody'), { games: 0, wins: 0, contested: 0, winRate: null, nights: 0, favourite: null, bestAt: null, recent: [] }, 'a player with no games');

  const titles = awardTitles(plays);
  assert.deepEqual(titles.get('mia'), ['Champion', 'Regular', 'Sharpshooter'], 'the leader holds all three');
  assert.deepEqual(titles.get('leo'), ['Regular'], 'ties share a title (4 nights each for mia, leo and zoe)');
  assert.deepEqual(titles.get('zoe'), ['Regular']);
  assert.equal(titles.get('sam'), undefined, 'no title for sam');
  assert.equal(awardTitles([]).size, 0, 'no titles without games');
  console.log('ok  player cards');
}

// ---- campaigns ---------------------------------------------------------------------------
{
  const plays = [
    { date: '2026-10-03', campaign: 'c1', createdAt: 2 },
    { date: '2026-09-26', campaign: 'c1', createdAt: 1 },
    { date: '2026-10-01', campaign: 'c2' },
    { date: '2026-10-02' },
  ];
  assert.deepEqual(sessionsOf(plays, 'c1').map((p) => p.date), ['2026-09-26', '2026-10-03'], 'only that campaign, oldest first');
  assert.deepEqual(sessionsOf(plays, 'nope'), [], 'no sessions yet');

  const campaigns = [
    { id: 'c1', status: 'active', players: ['mia', 'leo'], next: '2026-10-10', startedAt: '2026-09-20' },
    { id: 'c2', status: 'finished', players: ['mia', 'zoe'], winner: 'zoe', finishedAt: '2026-10-01', startedAt: '2026-08-01' },
    { id: 'c3', status: 'active', players: ['sam'], next: '', startedAt: '2026-10-02' },
  ];
  assert.deepEqual(plannedOn(campaigns, '2026-10-10').map((c) => c.id), ['c1'], 'a session planned for that day');
  assert.deepEqual(plannedOn(campaigns, '2026-10-11'), [], 'nothing planned');
  assert.deepEqual(plannedOn([{ ...campaigns[1], next: '2026-10-10' }], '2026-10-10'), [], 'finished campaigns plan nothing');
  assert.deepEqual(campaignRecord(campaigns, 'mia'), { played: 2, won: 0 });
  assert.deepEqual(campaignRecord(campaigns, 'zoe'), { played: 1, won: 1 });
  const { active, finished } = sortCampaigns(campaigns);
  assert.deepEqual(active.map((c) => c.id), ['c3', 'c1'], 'active: newest first');
  assert.deepEqual(finished.map((c) => c.id), ['c2']);
  assert.equal(defaultTitle({ name: 'Arcs' }), 'Arcs campaign');
  console.log('ok  campaigns');
}

// ---- who may do what in a campaign -------------------------------------------------------
{
  const open = { id: 'c1', status: 'active', locked: false, createdBy: 'mia', players: ['mia', 'leo'] };
  const locked = { ...open, locked: true };
  const done = { ...open, status: 'finished' };

  // a stranger can join an open campaign, but can't do anything else with it
  assert.deepEqual(can(open, 'zoe'), { join: true, leave: false, log: false, plan: false, manage: false, reopen: false, remove: false });
  assert.equal(can(locked, 'zoe').join, false, 'a locked campaign takes nobody new');
  assert.equal(can(open, null).join, false, 'nobody without a profile can join');

  // a member logs and plans, and may walk out until it is locked
  assert.deepEqual(can(open, 'leo'), { join: false, leave: true, log: true, plan: true, manage: false, reopen: false, remove: false });
  assert.deepEqual(can(locked, 'leo'), { join: false, leave: false, log: true, plan: true, manage: false, reopen: false, remove: false }, 'locked: nobody leaves');

  // the creator runs it, is always in, can still add people once it is locked, and can remove it
  assert.deepEqual(can(open, 'mia'), { join: false, leave: false, log: true, plan: true, manage: true, reopen: false, remove: true });
  assert.equal(can(locked, 'mia').manage, true);
  assert.equal(can(open, 'leo').manage, false, 'only the creator finishes it');
  assert.equal(can(open, 'leo').remove, false, 'only the creator removes it');

  // a signed-in admin can run and remove any campaign, but still has to be in it to log sessions
  assert.equal(can(open, 'zoe', { admin: true }).manage, true);
  assert.equal(can(open, 'zoe', { admin: true }).remove, true);
  assert.equal(can(open, 'zoe', { admin: true }).log, false);

  // a finished campaign is closed to everyone, except that its creator (or an admin) can reopen
  // or remove it
  const closed = { join: false, leave: false, log: false, plan: false, manage: false };
  assert.deepEqual(can(done, 'mia'), { ...closed, reopen: true, remove: true });
  assert.deepEqual(can(done, 'zoe', { admin: true }), { ...closed, reopen: true, remove: true });
  assert.deepEqual(can(done, 'leo'), { ...closed, reopen: false, remove: false }, 'a member can neither reopen nor remove it');
  assert.deepEqual(can(done, 'zoe'), { ...closed, reopen: false, remove: false }, 'neither can a stranger');
  assert.equal(can(open, 'mia', { admin: true }).reopen, false, 'a running campaign has nothing to reopen');

  // who could still be added
  assert.deepEqual(outsiders(open, [{ id: 'mia' }, { id: 'zoe' }, { id: 'sam' }]).map((p) => p.id), ['zoe', 'sam']);
  console.log('ok  campaign rights');
}

// ---- my games (a player's favourite / owned list) ----------------------------------------
{
  const azul = { id: 230802, name: 'Azul', year: 2017 };
  const arcs = { id: 359871, name: 'Arcs', year: 2024 };
  const byName = { id: null, name: 'Café Bonito!', year: 0 };

  let list = [];
  list = withGame(list, azul);
  list = withGame(list, byName);
  list = withGame(list, arcs);
  assert.deepEqual(list.map((g) => g.name), ['Azul', 'Café Bonito!', 'Arcs'], 'added in order, as plain { id, name, year }');
  assert.equal(withGame(list, { ...azul, by: 'someone' }), null, 'a game already on the list is not added twice');
  assert.equal(withGame(list, { id: null, name: 'cafe bonito' }), null, 'same name, case and accents ignored, counts as the same game');
  assert.ok(hasGame(list, { id: 359871 }), 'found by its BGG id');

  assert.deepEqual(withoutGame(list, voteKey(azul)).map((g) => g.name), ['Café Bonito!', 'Arcs'], 'removed by its key');
  assert.equal(withoutGame(list, 'g1').length, 3, 'removing something that is not there changes nothing');

  assert.deepEqual(matchMine(list, '').map((g) => g.name), ['Arcs', 'Azul', 'Café Bonito!'], 'no search: all of them, A to Z');
  assert.deepEqual(matchMine(list, 'ar').map((g) => g.name), ['Arcs'], 'a search narrows the list');
  assert.deepEqual(matchMine([...list, { id: 1, name: 'Star Realms' }], 'ar').map((g) => g.name), ['Arcs', 'Star Realms'], 'names starting with it come first');
  assert.deepEqual(matchMine(list, 'CAFE').map((g) => g.name), ['Café Bonito!'], 'case and accents are ignored');
  assert.deepEqual(matchMine(list, 'zzz'), [], 'nothing matches');

  const full = Array.from({ length: MAX_MY_GAMES }, (_, i) => ({ id: i + 1, name: `Game ${i + 1}`, year: 0 }));
  assert.equal(withGame(full, azul), null, 'the list has a limit');
  console.log('ok  my games');
}
