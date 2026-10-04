import { MIN_PLAYERS, MIN_PLAYERS_FOR_IDEAS, DAYS_AHEAD, DAYS_BEHIND, SITE_URL } from './config.js';
import { createStore, isForcedDemo } from './store.js';
import { avatar, randomSeed, hueOf } from './avatar.js';
import { icon, iconInner } from './icons.js';
import { upcomingDays, pastDays, longLabel, rangeLabel } from './dates.js';
import { buildIcs } from './ics.js';
import { tally, ranked as rankList, newestFirst, playerStats, awardTitles } from './hall.js';
import { sessionsOf, plannedOn, campaignRecord, sortCampaigns, defaultTitle, can, outsiders } from './campaigns.js';
import { MAX_MY_GAMES, hasGame, withGame, withoutGame, toggleFav, ordered, matchMine } from './mygames.js';
import { buildBackup, backupName, buildPlay, withoutUndefined } from './admin.js';
import {
  loadGames, isLoaded, findGame, searchGames, bggUrl, bggSearchUrl, parseBggLink, titleFromSlug, voteKey,
} from './games.js';

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const closeBtn = () => `<button type="button" class="icon-btn" data-action="close-dialog" aria-label="Close">${icon('x', 2)}</button>`;

const ls = {
  get(key) { try { return localStorage.getItem(key); } catch { return null; } },
  set(key, value) {
    try {
      if (value == null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    } catch { /* private mode: the app still works, it just forgets who you are */ }
  },
};

// ---------------------------------------------------------------------------
// theme: light / dark. index.html sets the first value before the page paints.
// Until the visitor picks one themselves, we keep following their device.
// ---------------------------------------------------------------------------

const THEME_KEY = 'bgn.theme';
const darkQuery = window.matchMedia?.('(prefers-color-scheme: dark)');
const currentTheme = () => (document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');

// The visitor's saved choice, otherwise whatever their device is set to right now.
function preferredTheme() {
  const saved = ls.get(THEME_KEY);
  if (saved === 'light' || saved === 'dark') return saved;
  return darkQuery?.matches ? 'dark' : 'light';
}

function applyTheme(theme, remember) {
  document.documentElement.dataset.theme = theme;
  if (remember) ls.set(THEME_KEY, theme);
  const dark = theme === 'dark';
  const button = $('#theme-btn');
  button.innerHTML = icon(dark ? 'sun' : 'moon', 2);
  button.setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode');
  button.title = dark ? 'Switch to light mode' : 'Switch to dark mode';
  syncThemeColor();
}

// Let the phone's browser bar match the header (purple on the calendar, gold in the hall of fame).
function syncThemeColor() {
  $('meta[name="theme-color"]').content = getComputedStyle(document.documentElement).getPropertyValue('--solid').trim();
}

darkQuery?.addEventListener?.('change', () => {
  if (!ls.get(THEME_KEY)) applyTheme(preferredTheme(), false);
});

// Which collapsible lists are open or closed, remembered on this device: { [id]: true | false }.
// A list nobody has touched is open or closed according to its own default.
const FOLDS_KEY = 'bgn.folds';
function loadFolds() {
  try { return JSON.parse(ls.get(FOLDS_KEY) ?? '{}') ?? {}; } catch { return {}; }
}
const isOpen = (id, openByDefault = true) => state.folds[id] ?? openByDefault;

// Whether this visitor is an admin: kept apart from `state` so it can be used while `state` is
// still being built. The Admin page only exists for admins; anyone else asking for it gets the calendar.
let adminOn = false;

const viewFromHash = () => (
  location.hash === '#hall' ? 'hall'
    : location.hash === '#campaigns' ? 'campaigns'
      : location.hash === '#admin' && adminOn ? 'admin'
        : 'calendar'
);

const state = {
  store: null,
  folds: loadFolds(),        // open/closed lists, by id ('wins', 'nights', 'plays', 'lastweek', 'sessions-<id>'...)
  ready: false,              // first data has arrived
  players: {},               // id -> { id, name, avatar }
  days: {},                  // YYYY-MM-DD -> { players: [id], games: [...] }
  meKey: 'bgn.me',           // localStorage key for "who am I" (the demo gets its own)
  me: null,                  // this device's player id
  admin: { canSignIn: false, signedIn: false, checking: false, isAdmin: false, uid: null },
  adminAsked: false,         // the visitor just pressed "Admin sign-in"
  onConfirm: null,           // what the confirm dialog's yes-button does
  daysList: [],              // the visible calendar days: today and the next two weeks
  pastDays: [],              // the week before today, for the "Last week" preview
  futureKeys: new Set(),     // keys of daysList, so we know which days can still be edited
  view: viewFromHash(),      // which page: 'calendar' | 'campaigns' | 'hall' | 'admin'
  campaigns: [],             // long games played over several sessions
  campaignsReady: false,
  campaignsError: false,     // campaigns couldn't be loaded (e.g. rules not updated yet)
  plays: [],                 // the hall of fame: one entry per game played
  playsReady: false,
  playsError: false,         // the hall of fame couldn't be loaded (e.g. rules not updated yet)
  installPrompt: null,       // the browser's "install this app" prompt, once it offers one
  log: null,                 // state of the "Log game night" popup
  start: null,               // state of the "Start a campaign" popup
  finish: null,              // state of the "Finish campaign" popup
  addPeople: null,           // state of the "Add players" popup of a campaign
  edit: null,                // state of the admin's "edit a hall-of-fame entry" form
  adminSelected: null,       // the player picked on the Admin page (their details and remove button show)
  adminAllPlays: false,      // the Admin page lists every logged game, not just the newest
  backupNote: '',            // what the last backup download contained
  backupBusy: false,
  mode: 'view',              // 'view' | 'pick'
  draft: new Set(),          // day keys selected while picking
  saving: false,
  openKey: null,             // day whose panel is open
  askedWho: false,
  who: { mode: 'choose', cands: [], sel: 0 },
  gamesFailed: false,
};

const sortedPlayers = () => Object.values(state.players).sort((a, b) => a.name.localeCompare(b.name));
const byName = (a, b) => state.players[a].name.localeCompare(state.players[b].name);

// Who is saved as available on a day (ignores players that no longer exist).
const savedIds = (key) => (state.days[key]?.players ?? []).filter((id) => state.players[id]);
const savedMine = (key) => !!state.me && savedIds(key).includes(state.me);

// Who counts as available on a day, including my not-yet-saved picks while in pick mode.
function peopleOn(key) {
  let ids = savedIds(key);
  // picks only apply to days that can still be edited, never to last week's
  if (state.mode === 'pick' && state.me && state.futureKeys.has(key)) {
    const has = ids.includes(state.me);
    const wants = state.draft.has(key);
    if (wants && !has) ids = [...ids, state.me];
    if (!wants && has) ids = ids.filter((id) => id !== state.me);
  }
  return ids.sort(byName);
}

const changeCount = () => state.daysList.filter((d) => state.draft.has(d.key) !== savedMine(d.key)).length;

// Any day we show: the next two weeks, or last week.
const dayByKey = (key) => state.daysList.find((d) => d.key === key) ?? state.pastDays.find((d) => d.key === key);

// Game nights that happened (3+ available) but were never logged in the hall of fame.
const loggedDates = () => new Set(state.plays.map((p) => p.date));
const unloggedNights = () => state.pastDays.filter(
  (d) => savedIds(d.key).length >= MIN_PLAYERS && !loggedDates().has(d.key),
);

// A day's games, most votes first (ties keep the order they were added). Only votes from
// players who are available that day count: a vote from someone who is no longer
// available (or no longer exists) is ignored, and comes back if they become available again.
// The same goes for "I'll bring it": it only counts while the bringer is available.
function rankGames(key) {
  const games = state.days[key]?.games ?? [];
  const votes = state.days[key]?.votes ?? {};
  const brings = state.days[key]?.brings ?? {};
  const available = new Set(savedIds(key));
  const who = (map, g) => (map[voteKey(g)] ?? []).filter((id) => available.has(id)).sort(byName);
  const ranked = games
    .map((g, i) => ({ g, i, voters: who(votes, g), bringers: who(brings, g) }))
    .sort((a, b) => b.voters.length - a.voters.length || a.i - b.i);
  return { ranked, topVotes: ranked[0]?.voters.length ?? 0 };
}

// A game night's location and start time, e.g. "Mia's place · 19:30", or null if neither is set.
function detailsLine(key) {
  const { place = '', time = '' } = state.days[key]?.details ?? {};
  return [place, time].filter(Boolean).join(' · ') || null;
}

// "Top pick so far: Azul (2 votes)", or null while nobody has voted.
function topPickLine(key) {
  const { ranked, topVotes } = rankGames(key);
  if (!topVotes) return null;
  const leaders = ranked.filter((r) => r.voters.length === topVotes).map((r) => r.g.name);
  return leaders.length === 1
    ? `Top pick so far: ${leaders[0]} (${plural(topVotes, 'vote')})`
    : `Tied at the top: ${leaders.join(', ')}`;
}

// "Mia, Leo and Zoe", or "Mia, Leo, Zoe, Sam and 2 more" once the list gets long.
function listNames(ids, max = 4) {
  const shown = ids.slice(0, max).map((id) => state.players[id].name);
  if (ids.length > max) shown.push(`${ids.length - max} more`);
  return new Intl.ListFormat('en-GB', { style: 'long', type: 'conjunction' }).format(shown);
}

// The messages the admin can send to the WhatsApp group. Nothing is sent from here:
// the link opens WhatsApp with the text filled in, and the admin picks the chat and
// taps send.
function whatsappText(kind, day) {
  const ids = savedIds(day.key).sort(byName);
  const when = longLabel(day.date);
  const pick = topPickLine(day.key);
  const where = detailsLine(day.key);
  const lines = kind === 'remind'
    ? [`⏰ Game night ${day.isToday ? 'today' : 'tomorrow'}! (${when})`, `In: ${listNames(ids, 99)}`]
    : [`🎲 Game night on ${when}?`, `Available so far: ${listNames(ids, 99)}`];
  if (where) lines.push(`📍 ${where}`);
  if (pick) lines.push(pick);
  lines.push(kind === 'remind' ? `Details and votes: ${SITE_URL}` : `Pick your days and vote: ${SITE_URL}`);
  return lines.join('\n');
}
const whatsappLink = (text) => `https://wa.me/?text=${encodeURIComponent(text)}`;

let toastTimer;
function toast(message) {
  const el = $('#toast');
  el.textContent = message;
  el.classList.add('show');
  try { if (el.showPopover && !el.matches(':popover-open')) el.showPopover(); } catch { /* unsupported */ }
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.classList.remove('show');
    try { el.hidePopover?.(); } catch { /* already hidden */ }
  }, 2600);
}

function fail(err, message = 'Something went wrong. Please try again.') {
  console.error(err);
  toast(message);
}

function showBanner(html) {
  const el = $('#banner');
  el.innerHTML = html;
  el.hidden = false;
}

// ---------------------------------------------------------------------------
// rendering: page chrome
// ---------------------------------------------------------------------------

function renderStatic() {
  $('#brand-icon').innerHTML = icon('meeple', 3);
  $('#tab-calendar').innerHTML = `${icon('calendar', 2)}<span>Calendar</span>`;
  $('#tab-campaigns').innerHTML = `${icon('flag', 2)}<span>Campaigns</span>`;
  $('#tab-hall').innerHTML = `${icon('trophy', 2)}<span>Hall of fame</span>`;
  $('#tab-admin').innerHTML = `${icon('shield', 2)}<span>Admin</span>`;
  $('#admin-title').innerHTML = `${icon('shield', 3)}<span>Admin</span>`;
  $('#campaigns-title').innerHTML = `${icon('flag', 3)}<span>Campaigns</span>`;
  $('#hall-title').innerHTML = `${icon('trophy', 3)}<span>Hall of fame</span>`;
  applyTheme(preferredTheme(), false);   // also catches a device change that landed after the inline script ran
  const favicon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" rx="5" fill="#6d28d9"/><g color="#fff" transform="translate(2.4 2.4) scale(.8)">${iconInner('meeple')}</g></svg>`;
  $('#favicon').href = `data:image/svg+xml,${encodeURIComponent(favicon)}`;
  $('#legend').innerHTML = `
    <li><span class="swatch swatch--mine"></span>You're available</li>
    <li><span class="swatch swatch--go"></span>${MIN_PLAYERS}+ available: game on</li>
    <li><span class="swatch swatch--weekend"></span>Weekend</li>`;
}

const isSharedAdmin = () => state.store?.mode === 'firebase' && state.admin.isAdmin;

// What I may do with a campaign (join, log, lock, finish...). See js/campaigns.js.
const myRights = (c) => can(c, state.me, { admin: isSharedAdmin() });

function renderHeader() {
  const me = state.players[state.me];
  const adminTag = isSharedAdmin() ? '<span class="tag">Admin</span>' : '';
  $('#me-slot').innerHTML = adminTag + (me
    ? `<button type="button" class="chip" style="--h:${hueOf(me.avatar)}" data-action="profile" aria-label="Your profile: ${esc(me.name)}">${avatar(me.avatar, 28)}<span class="chip-name">${esc(me.name)}</span></button>`
    : state.ready
      ? `<button type="button" class="chip" data-action="who">${icon('plus', 2)}<span class="chip-name">Join</span></button>`
      : '');
}

// Footer: the admin sign-in link, and what state it is in.
function renderFooter() {
  const a = state.admin;
  const link = (action, label) => `<button type="button" class="link-btn" data-action="${action}">${label}</button>`;
  let html = '';
  if (state.store?.mode === 'firebase') {
    if (a.isAdmin) html = `Admin mode is on · ${link('admin-signout', 'Sign out')}`;
    else if (a.checking) html = 'Checking admin access…';
    else if (a.signedIn) html = `Signed in, but not an admin yet · ${link('admin-help', 'Set up')} · ${link('admin-signout', 'Sign out')}`;
    else html = link('admin-signin', 'Admin sign-in');
  }
  $('#admin-slot').innerHTML = html;

  // "Install as an app": hidden once it's installed (opened from the home screen).
  const installed = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  $('#install-slot').innerHTML = installed ? '' : link('install', 'Install as an app');
}

function renderToolbar() {
  const picking = state.mode === 'pick';
  const ready = state.daysList.filter((d) => peopleOn(d.key).length >= MIN_PLAYERS).length;
  let summary = '';
  if (state.ready) {
    if (picking) summary = 'Tap every day you can play';
    else if (ready) summary = `${icon('star', 2)} ${plural(ready, 'day')} ready to play`;
    else summary = `No day has ${MIN_PLAYERS}+ players yet`;
  }
  $('#toolbar').innerHTML = `<p class="summary">${summary}</p>${
    state.ready && !picking ? '<button type="button" class="btn btn--solid" data-action="pick">Pick my days</button>' : ''}`;

  const bar = $('#savebar');
  const showBar = picking && state.view === 'calendar';   // not on the hall of fame page
  bar.hidden = !showBar;
  document.body.classList.toggle('has-savebar', showBar);
  if (picking) {
    const n = changeCount();
    bar.innerHTML = `
      <span class="savebar-text">${n ? plural(n, 'change') : 'No changes yet'}</span>
      <button type="button" class="btn" data-action="cancel-pick"${state.saving ? ' disabled' : ''}>Cancel</button>
      <button type="button" class="btn btn--solid" data-action="save-pick"${n && !state.saving ? '' : ' disabled'}>${state.saving ? 'Saving…' : 'Save'}</button>`;
  }
}

function dayTile(d) {
  const ids = peopleOn(d.key);
  const go = ids.length >= MIN_PLAYERS;
  const picking = state.mode === 'pick' && !d.isPast;   // last week can't be picked
  const mine = !!state.me && ids.includes(state.me);
  const changed = picking && state.draft.has(d.key) !== savedMine(d.key);
  const campaigns = plannedOn(state.campaigns, d.key);
  // a session of a campaign I'm in gets a round flag badge on the corner of the day; other campaigns a small tag
  const myCamps = state.me ? campaigns.filter((c) => c.players.includes(state.me)) : [];
  const myCampaign = myCamps.length > 0;
  const othersPlanned = campaigns.length > myCamps.length;
  const logged = d.isPast && loggedDates().has(d.key);
  const cls = [
    'day', mine && 'is-mine', go && 'is-go', d.isWeekend && 'is-weekend', d.isPast && 'is-past',
    d.isToday && 'is-today', changed && 'is-changed', !ids.length && 'is-empty',
  ].filter(Boolean).join(' ');
  const label = `${longLabel(d.date)}: ${plural(ids.length, 'player')} available${go ? (d.isPast ? ', was a game night' : ', game on') : ''}${mine ? ', including you' : ''}${campaigns.length ? `, campaign session: ${campaigns.map((c) => c.title).join(', ')}${myCampaign ? " (you're in it)" : ''}` : ''}${d.isPast && go ? (logged ? ', logged' : ', not logged yet') : ''}`;
  const faces = ids.map((id) => avatar(state.players[id].avatar, 22, state.players[id].name)).join('');
  const sub = d.isToday ? 'Today' : d.num === 1 ? d.month : '';
  return `
    <button type="button" class="${cls}" data-action="${d.isPast ? 'open-day' : 'day'}" data-date="${d.key}" aria-label="${esc(label)}"${picking ? ` aria-pressed="${mine}"` : ''}>
      ${myCampaign ? `<span class="day-badge" title="${esc(`Your campaign: ${myCamps.map((c) => c.title).join(', ')}`)}" aria-hidden="true">${icon('flag', 2)}</span>` : ''}
      <span class="day-date">
        <span class="day-dow">${d.dow}</span>
        <span class="day-num">${d.num}</span>
        <span class="day-sub">${sub}</span>
      </span>
      <span class="day-people">${faces}</span>
      <span class="day-status">
        <span class="day-count">${ids.length} available</span>
        ${go && !d.isPast ? `<span class="day-flag">${icon('star', 2)}<span>Game on</span></span>` : ''}
        ${d.isPast && go ? `<span class="day-log ${logged ? 'is-done' : 'is-todo'}">${icon(logged ? 'check' : 'trophy', 2)}<span>${logged ? 'Logged' : 'Not logged'}</span></span>` : ''}
        ${othersPlanned ? `<span class="day-campaign">${icon('flag', 2)}<span>Campaign</span></span>` : ''}
        ${picking ? `<span class="day-check">${mine ? icon('check', 2) : ''}</span>` : ''}
      </span>
    </button>`;
}

// The week before today, collapsed by default. It stays so a game night nobody logged on the
// day itself can still be logged afterwards; it opens by itself while there is one to log.
function renderLastWeek() {
  const el = $('#lastweek');
  if (!state.ready || !state.pastDays.length) {
    el.innerHTML = '';
    return;
  }
  const todo = unloggedNights().length;
  const focused = el.contains(document.activeElement) ? document.activeElement.dataset.date : null;
  el.innerHTML = fold('lastweek', 'Last week', {
    count: todo ? `${todo} to log` : '',
    open: todo > 0,
    body: `<div class="calendar">${state.pastDays.map(dayTile).join('')}</div>`,
  });
  if (focused) $(`[data-date="${focused}"]`, el)?.focus({ preventScroll: true });
}

function renderCalendar() {
  const el = $('#calendar');
  $('#range').textContent = state.daysList.length ? rangeLabel(state.daysList) : '';
  if (!state.ready) {
    el.innerHTML = '<p class="loading">Loading…</p>';
    return;
  }
  const focused = el.contains(document.activeElement) ? document.activeElement.dataset.date : null;
  el.classList.toggle('is-picking', state.mode === 'pick');
  el.innerHTML = state.daysList.map(dayTile).join('');
  if (focused) $(`[data-date="${focused}"]`, el)?.focus({ preventScroll: true });
}

// "Players" under the calendar: a collapsible list. Closed (the default) it shows just the faces,
// open it shows everyone by name; tap anyone for their player card. (Removing a player is done on
// the Admin page, not here.)
function renderPlayers() {
  const el = $('#players');
  el.hidden = !state.ready;
  if (!state.ready) return;
  const list = sortedPlayers();
  if (!list.length) {
    el.innerHTML = '<h2 class="h-small">Players</h2><p class="muted">Nobody has joined yet. Be the first!</p>';
    return;
  }
  const faces = `<div class="fold-preview"><ul class="player-faces">${list.map((p) => `
      <li><button type="button" class="face-btn${p.id === state.me ? ' is-me' : ''}" style="--h:${hueOf(p.avatar)}" data-action="player-card" data-id="${esc(p.id)}" title="${esc(p.name)}${p.id === state.me ? ' (you)' : ''}" aria-label="Show ${esc(p.name)}'s card">${avatar(p.avatar, 30)}</button></li>`).join('')}</ul></div>`;
  const names = `<ul class="player-list">${list.map((p) => `
      <li class="player-item${p.id === state.me ? ' is-me' : ''}" style="--h:${hueOf(p.avatar)}"><button type="button" class="pill-btn" data-action="player-card" data-id="${esc(p.id)}" title="Show ${esc(p.name)}'s card">${avatar(p.avatar, 28)}<span>${esc(p.name)}${p.id === state.me ? ' <em>(you)</em>' : ''}</span></button></li>`).join('')}</ul>`;
  el.innerHTML = fold('players', 'Players', { count: list.length, open: false, preview: faces, body: names });
}

// Admin only. It's a convenience rather than a lock (the link just fills in a WhatsApp
// message that anyone could write), so it keeps the buttons off everyone else's screen.
// For today and tomorrow it's a reminder; for later days it announces the game night.
function whatsappButton(day, extraClass = '') {
  const soon = day.isToday || day.key === state.daysList[1]?.key;
  const link = whatsappLink(whatsappText(soon ? 'remind' : 'announce', day));
  return `<a class="btn ${extraClass}" href="${esc(link)}" target="_blank" rel="noopener noreferrer" title="Opens WhatsApp with a ready-made message">${soon ? 'Remind the group' : 'Tell the group'} ${icon('arrow', 2)}</a>`;
}

// The orange banners, for today and tomorrow (calendar page only):
//  - a game night: shown to everyone when the day has enough players available
//  - a campaign session: shown to the people in that campaign, when its next day is planned
//    for today or tomorrow
function renderReminder() {
  const el = $('#reminder');
  const days = state.ready && state.view === 'calendar' ? state.daysList.slice(0, 2) : [];
  const items = [];
  for (const d of days) {
    if (savedIds(d.key).length >= MIN_PLAYERS) items.push(gameNightBanner(d));
    for (const c of plannedOn(state.campaigns, d.key)) {
      if (state.me && c.players.includes(state.me)) items.push(campaignBanner(d, c));
    }
  }
  el.hidden = !items.length;
  el.innerHTML = items.join('');
}

const whenWord = (d) => (d.isToday ? 'today' : 'tomorrow');

// The banners are one short line each: when, the upcoming game, and a link to it (the game
// night's day, or the campaign). Everything else is one tap away.
const bannerLink = (action, attrs, label) => `<button type="button" class="reminder-link" data-action="${action}" ${attrs}>${label}${icon('arrow', 2)}</button>`;

function gameNightBanner(d) {
  const { ranked, topVotes } = rankGames(d.key);
  const leaders = ranked.filter((r) => topVotes && r.voters.length === topVotes);
  const game = leaders.length === 1 ? leaders[0].g.name : leaders.length ? 'game still tied' : 'no game picked yet';
  return `
    <div class="reminder-item">
      <span class="reminder-icon">${icon('bell', 2)}</span>
      <p class="reminder-text"><strong>Game night ${whenWord(d)}</strong><span>${esc(game)}</span></p>
      <span class="reminder-actions">
        ${bannerLink('open-day', `data-date="${d.key}"`, 'See the game night')}
        ${state.admin.isAdmin ? whatsappButton(d, 'btn--small') : ''}
      </span>
    </div>`;
}

function campaignBanner(d, c) {
  const session = state.playsReady ? ` · session ${sessionsOf(state.plays, c.id).length + 1}` : '';
  return `
    <div class="reminder-item">
      <span class="reminder-icon">${icon('flag', 2)}</span>
      <p class="reminder-text"><strong>Campaign ${whenWord(d)}</strong><span>${esc(c.title)}${session}</span></p>
      <span class="reminder-actions">
        ${bannerLink('open-campaign', `data-id="${esc(c.id)}"`, 'See the campaign')}
      </span>
    </div>`;
}

// Takes you to the campaign on the Campaigns page, with the list it is in (running or
// finished) opened. Used from the banners, the day panel and after reopening a campaign.
function showCampaign(id) {
  const c = state.campaigns.find((x) => x.id === id);
  if (!c) return toast("That campaign isn't there any more.");
  if ($('#day-dialog').open) $('#day-dialog').close();
  state.folds[c.status === 'finished' ? 'finished-campaigns' : 'running-campaigns'] = true;
  ls.set(FOLDS_KEY, JSON.stringify(state.folds));
  if (location.hash === '#campaigns') renderAll();
  else location.hash = '#campaigns';
  setTimeout(() => document.getElementById(`campaign-${id}`)?.scrollIntoView({ block: 'start' }), 60);
}

// ---------------------------------------------------------------------------
// hall of fame
// ---------------------------------------------------------------------------

// Someone who has left the group is still shown by the name they had: logged games and
// campaigns keep a snapshot of the names.
const nameFromHistory = (id) => state.plays.find((p) => p.names?.[id])?.names[id]
  ?? state.campaigns.find((c) => c.names?.[id])?.names[id]
  ?? 'Former player';
const playerName = (id) => state.players[id]?.name ?? nameFromHistory(id);

// A player as a tinted pill; tap it for their card. Someone who has since left the group
// shows as plain text.
function playerPill(id) {
  const p = state.players[id];
  return p
    ? `<button type="button" class="pill" style="--h:${hueOf(p.avatar)}" data-action="player-card" data-id="${esc(id)}" title="Show ${esc(p.name)}'s card">${avatar(p.avatar, 24, p.name)}<span>${esc(p.name)}</span></button>`
    : `<span class="pill is-gone"><span>${esc(playerName(id))}</span><em>(left)</em></span>`;
}

// "Campaign: Arcs: the long game · session 2", for a play that belongs to a campaign.
function campaignTag(play) {
  if (!play.campaign) return '';
  const campaign = state.campaigns.find((c) => c.id === play.campaign);
  const session = sessionsOf(state.plays, play.campaign).findIndex((s) => s.id === play.id) + 1;
  return `<span class="campaign-tag">${icon('flag', 2)}<span>${campaign ? esc(campaign.title) : 'Campaign'}${session ? ` · session ${session}` : ''}</span></span>`;
}

function dateLabel(key) {   // "Fri 9 Oct 2026"
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}

function rankingList(rows, unit) {
  if (!rows.length) return '<p class="muted">Nothing yet.</p>';
  return `<ol class="ranking">${rows.map((r) => `
    <li class="rank-row${r.rank === 1 ? ' is-first' : ''}">
      <span class="rank" aria-label="Rank ${r.rank}">${r.rank === 1 ? icon('trophy', 2) : r.rank}</span>
      ${playerPill(r.id)}
      <span class="score"><strong>${r.n}</strong> ${unit}${r.n === 1 ? '' : 's'}</span>
    </li>`).join('')}</ol>`;
}

function playRow(p) {
  const g = p.game ?? {};
  const faces = p.players.filter((id) => state.players[id])
    .map((id) => avatar(state.players[id].avatar, 22, state.players[id].name)).join('');
  return `
    <li class="play">
      <div class="play-head">
        <span class="play-date">${esc(dateLabel(p.date))}</span>
        ${state.admin.isAdmin ? `<button type="button" class="icon-btn icon-btn--small" data-action="delete-play" data-id="${esc(p.id)}" aria-label="Remove this entry">${icon('x', 2)}</button>` : ''}
      </div>
      <a class="game-link" href="${esc(g.id ? bggUrl(g.id) : bggSearchUrl(g.name))}" target="_blank" rel="noopener noreferrer">
        <span class="game-name">${esc(g.name)}</span>${g.year ? `<span class="game-year">${g.year}</span>` : ''}${icon('arrow', 2)}
        <span class="sr-only">(opens BoardGameGeek)</span>
      </a>
      ${p.campaign ? `<div>${campaignTag(p)}</div>` : ''}
      <div class="play-line"><span class="play-label">Winner</span>${p.winner ? playerPill(p.winner) : '<span class="muted">Nobody (co-op or draw)</span>'}</div>
      <div class="play-line"><span class="play-label">Played by</span><span class="play-faces">${faces}</span><span class="muted">${plural(p.players.length, 'player')}</span></div>
      ${p.note ? `<p class="play-note">${esc(p.note)}</p>` : ''}
    </li>`;
}

function renderHall() {
  const body = $('#hall-body');
  const count = $('#hall-count');
  count.textContent = '';
  if (state.playsError) {
    body.innerHTML = "<p class=\"muted\">The hall of fame can't be loaded right now. (Site owner: publish the updated Firestore rules from the README.)</p>";
    return;
  }
  if (!state.playsReady) {
    body.innerHTML = '<p class="loading">Loading…</p>';
    return;
  }
  const plays = newestFirst(state.plays);
  if (!plays.length) {
    body.innerHTML = `
      <div class="hall-empty">
        ${icon('trophy', 4)}
        <p><strong>Nothing logged yet.</strong> After a game night, open that day on the calendar and tap <em>Log game night</em>. Winners and regulars end up here.</p>
      </div>`;
    return;
  }
  const t = tally(plays);
  const wins = rankList(t.wins, playerName);
  const nights = rankList(t.nights, playerName);
  count.textContent = `${plural(t.gameCount, 'game')} · ${plural(t.nightCount, 'night')}`;
  body.innerHTML = `
    <div class="rankings">
      ${fold('wins', 'Most wins', { count: wins.length, preview: leaderPreview(wins, 'win'), body: rankingList(wins, 'win') })}
      ${fold('nights', 'Most game nights', { count: nights.length, preview: leaderPreview(nights, 'night'), body: rankingList(nights, 'night') })}
    </div>
    ${fold('plays', 'Games played', { count: plays.length, body: `<ul class="plays">${plays.map(playRow).join('')}</ul>` })}`;
}

// A list the visitor can collapse. `preview` is what stays visible while it is collapsed.
// `open` is whether it starts open (until the visitor toggles it); `count` is the little badge.
function fold(id, title, { count, preview = '', body, open: openByDefault = true }) {
  const open = isOpen(id, openByDefault);
  const badge = count === undefined || count === '' ? '' : ` <span class="count">${esc(count)}</span>`;
  return `
    <section class="fold${open ? '' : ' is-collapsed'}">
      <button type="button" class="fold-head" data-action="toggle-fold" data-fold="${esc(id)}" data-default="${openByDefault ? 1 : 0}" aria-expanded="${open}" aria-controls="fold-${esc(id)}">
        <span class="h-small">${esc(title)}${badge}</span>
        ${icon('chevron', 2)}
      </button>
      ${open ? '' : preview}
      <div id="fold-${esc(id)}" class="fold-body"${open ? '' : ' hidden'}>${body}</div>
    </section>`;
}

// While a ranking is collapsed, just the leader: the first row, plus a note if others tie for first.
function leaderPreview(rows, unit) {
  const leaders = rows.filter((r) => r.rank === 1);
  if (!leaders.length) return '';
  return `<div class="fold-preview">${rankingList(leaders.slice(0, 1), unit)}${
    leaders.length > 1 ? `<p class="muted fold-note">+${leaders.length - 1} more tied for first</p>` : ''}</div>`;
}

// Which page is showing. Each page has its own colours (purple, teal, gold, slate), set by data-page.
// The Admin tab is only there for admins.
function renderView() {
  const view = state.view;
  document.documentElement.dataset.page = view;
  $('#tab-admin').hidden = !adminOn;
  for (const page of ['calendar', 'campaigns', 'hall', 'admin']) {
    $(`#view-${page}`).hidden = page !== view;
    const tab = $(`#tab-${page}`);
    if (page === view) tab.setAttribute('aria-current', 'page');
    else tab.removeAttribute('aria-current');
  }
  syncThemeColor();
}

window.addEventListener('hashchange', () => {
  state.view = viewFromHash();
  window.scrollTo(0, 0);
  renderAll();
});

function renderAll() {
  renderView();
  renderHeader();
  renderReminder();
  renderFooter();
  renderToolbar();
  renderCalendar();
  renderLastWeek();
  renderPlayers();
  renderCampaigns();
  renderHall();
  renderAdmin();
  renderDayPanel();
  renderMyGames();
}

// ---------------------------------------------------------------------------
// picking days
// ---------------------------------------------------------------------------

function startPick() {
  if (!state.me) return openWho('choose');
  state.mode = 'pick';
  state.draft = new Set(state.daysList.filter((d) => savedMine(d.key)).map((d) => d.key));
  renderAll();
}

function toggleDraft(key) {
  if (state.saving) return;
  if (state.draft.has(key)) state.draft.delete(key);
  else state.draft.add(key);
  renderToolbar();
  renderCalendar();
}

async function savePick() {
  const add = [], remove = [];
  for (const d of state.daysList) {
    const wants = state.draft.has(d.key), has = savedMine(d.key);
    if (wants && !has) add.push(d.key);
    if (!wants && has) remove.push(d.key);
  }
  state.saving = true;
  renderToolbar();
  try {
    await state.store.setAvailability(state.me, add, remove);
    state.mode = 'view';
    toast('Saved!');
  } catch (err) {
    fail(err, "Couldn't save. Check your connection and try again.");
  } finally {
    state.saving = false;
    renderAll();
  }
}

// ---------------------------------------------------------------------------
// day panel (who's available + game options)
// ---------------------------------------------------------------------------

function openDay(key) {
  state.openKey = key;
  $('#day-dialog').innerHTML = `
    <div class="sheet-head">
      <h2 id="dp-title"></h2>
      <button type="button" class="icon-btn" data-action="close-dialog" aria-label="Close">${icon('x', 2)}</button>
    </div>
    <div class="sheet-body">
      <section id="dp-who" class="block"></section>
      <section id="dp-campaign" class="block"></section>
      <section id="dp-details" class="block"></section>
      <section id="dp-games" class="block">
        <div id="dp-games-head"></div>
        <div id="dp-preview"></div>
        <ul id="dp-list" class="games"></ul>
        <div id="dp-add">
          <button type="button" id="dp-add-open" class="btn btn--solid btn--wide" data-action="adder-open">${icon('plus', 2)} Add a game</button>
          <form id="dp-add-form" hidden autocomplete="off">
            <label class="sr-only" for="game-q">Search for a game</label>
            <input id="game-q" type="search" placeholder="Search BoardGameGeek, or paste a link" enterkeyhint="search" spellcheck="false">
            <ul id="game-results" class="results"></ul>
            <button type="button" class="btn" data-action="open-collection">${icon('box', 2)} Add game from collection <span id="dp-coll-count" class="count"></span></button>
            <button type="button" class="btn" data-action="adder-close">Cancel</button>
          </form>
        </div>
      </section>
    </div>`;
  renderDayPanel();
  $('#day-dialog').showModal();
}

function renderDayPanel() {
  const key = state.openKey;
  if (!key || !$('#dp-title')) return;
  const day = dayByKey(key);
  if (!day) return;
  const ids = savedIds(key).sort(byName);
  const go = ids.length >= MIN_PLAYERS;                         // a real game night: green, "Game on"
  const canSuggest = ids.length >= MIN_PLAYERS_FOR_IDEAS;       // ideas can be added and voted on
  const mine = savedMine(key);
  const past = day.isPast;                                      // last week: you can look, and log what was played
  const canAct = mine && !past;                                 // vote, bring, edit the details
  const games = state.days[key]?.games ?? [];
  const lockedTitle = past ? 'This day has passed' : 'Only players who are available this day can do this';

  $('#dp-title').innerHTML = `${esc(longLabel(day.date))}${go ? `<span class="day-flag">${icon('star', 2)}<span>${past ? 'Was a game night' : 'Game on'}</span></span>` : ''}`;

  $('#dp-who').innerHTML = `
    <h3 class="h-small">Who's available <span class="count">${ids.length}</span></h3>
    ${ids.length
    ? `<ul class="people">${ids.map((id) => `<li style="--h:${hueOf(state.players[id].avatar)}"><button type="button" class="pill-btn" data-action="player-card" data-id="${esc(id)}" title="Show ${esc(state.players[id].name)}'s card">${avatar(state.players[id].avatar, 32)}<span>${esc(state.players[id].name)}${id === state.me ? ' <em>(you)</em>' : ''}</span></button></li>`).join('')}</ul>`
    : `<p class="muted">${past ? 'Nobody was available.' : 'Nobody yet.'}</p>`}
    ${past ? '' : `<button type="button" class="btn${mine ? '' : ' btn--solid'}" data-action="toggle-me">${mine ? "I can't make it" : "I'm available this day"}</button>`}
    ${state.admin.isAdmin && go && !past ? whatsappButton(day) : ''}`;

  // A campaign session planned for this day (see the Campaigns tab).
  const planned = plannedOn(state.campaigns, key);
  $('#dp-campaign').hidden = !planned.length;
  $('#dp-campaign').innerHTML = planned.map((c) => {
    // the campaign's players; the ones who haven't said they're available that day are faded
    const crew = c.players.filter((id) => state.players[id]);
    const here = new Set(ids);
    const faces = crew.map((id) => {
      const away = !here.has(id);
      return `<span class="plan-face${away ? ' is-away' : ''}">${avatar(state.players[id].avatar, 24, `${state.players[id].name}${away ? " (hasn't said they're available)" : ''}`)}</span>`;
    }).join('');
    // One line while collapsed (the default), so it doesn't take over the panel; the details open on tap.
    const foldId = `dpc-${c.id}`;
    const open = isOpen(foldId, false);
    return `
    <div class="campaign-plan${open ? '' : ' is-collapsed'}">
      <button type="button" class="campaign-plan-head" data-action="toggle-fold" data-fold="${esc(foldId)}" data-default="0" aria-expanded="${open}" aria-controls="${esc(foldId)}">
        <span class="campaign-plan-icon">${icon('flag', 2)}</span>
        <strong>Campaign session: ${esc(c.title)}</strong>
        ${icon('chevron', 2)}
      </button>
      <div id="${esc(foldId)}" class="campaign-plan-body"${open ? '' : ' hidden'}>
        <span class="muted">${esc(c.game.name)} · session ${sessionsOf(state.plays, c.id).length + 1}</span>
        <span class="plan-faces">${faces}<span class="muted">${crew.filter((id) => here.has(id)).length} of ${crew.length} available</span></span>
        <div class="campaign-plan-actions">
          ${(day.isToday || past) && myRights(c).log ? `<button type="button" class="btn btn--small" data-action="log-session" data-campaign="${esc(c.id)}" data-date="${esc(key)}">Log session</button>` : ''}
          <button type="button" class="btn btn--small" data-action="open-campaign" data-id="${esc(c.id)}">See campaign ${icon('arrow', 2)}</button>
        </div>
      </div>
    </div>`;
  }).join('');

  // Where and when, adding it to a calendar, and logging what was played (today and last week).
  const { place = '', time = '' } = state.days[key]?.details ?? {};
  const hasDetails = !!(place || time);
  const showDetails = go || hasDetails;
  const canLog = day.isToday || past;
  const loggedHere = canLog ? state.plays.filter((p) => p.date === key) : [];
  const dayButtons = [
    go && !past ? `<button type="button" class="btn" data-action="add-to-calendar">${icon('calendar', 2)} Add to calendar</button>` : '',
    canLog ? `<button type="button" class="btn btn--solid" data-action="log-game-night">${icon('trophy', 2)} Log game night</button>` : '',
  ].join('');
  $('#dp-details').hidden = !showDetails && !dayButtons && !loggedHere.length;
  $('#dp-details').innerHTML = `
    ${showDetails ? `
      <div class="head-row">
        <h3 class="h-small">Game night</h3>
        ${canAct ? `<button type="button" class="btn btn--small" data-action="edit-details">${hasDetails ? 'Edit' : 'Add location &amp; time'}</button>` : ''}
      </div>
      ${hasDetails
    ? `<ul class="details">${place ? `<li>${icon('pin', 2)}<span>${esc(place)}</span></li>` : ''}${time ? `<li>${icon('clock', 2)}<span>${esc(time)}</span></li>` : ''}</ul>`
    : '<p class="muted">No location yet.</p>'}` : ''}
    ${loggedHere.length ? `
      <div>
        <h3 class="h-small">Logged</h3>
        <ul class="logged">${loggedHere.map((p) => {
    const camp = p.campaign ? state.campaigns.find((c) => c.id === p.campaign) : null;
    return `<li>${icon('check', 2)}<span>${esc(p.game.name)}${p.winner ? ` · ${esc(playerName(p.winner))} won` : ''}${camp
      ? ` · <button type="button" class="link-btn" data-action="open-campaign" data-id="${esc(camp.id)}">${esc(camp.title)}${icon('arrow', 2)}</button>` : ''}</span></li>`;
  }).join('')}</ul>
      </div>` : ''}
    ${dayButtons ? `<div class="actions">${dayButtons}</div>` : ''}`;

  const { ranked, topVotes } = rankGames(key);

  // One game on the list. They come most-voted first (rankGames sorts them that way).
  const row = ({ g, voters, bringers }) => {
    const by = state.players[g.by];
    const k = voteKey(g);
    const voted = !!state.me && voters.includes(state.me);
    const bringing = !!state.me && bringers.includes(state.me);
    const top = ranked.length > 1 && topVotes > 0 && voters.length === topVotes;
    const locked = canAct ? '' : ` aria-disabled="true" title="${lockedTitle}"`;
    return `
        <li class="game${top ? ' is-top' : ''}">
          <button type="button" class="vote${voted ? ' is-on' : ''}${canAct ? '' : ' is-locked'}" data-action="vote" data-gk="${esc(k)}" aria-pressed="${voted}"${locked}
            aria-label="${voted ? 'Take back your vote for' : 'Vote for'} ${esc(g.name)} (${plural(voters.length, 'vote')} so far)">
            ${icon('up', 2)}<span>${voters.length}</span>
          </button>
          <div class="game-main">
            <a class="game-link" href="${g.id ? bggUrl(g.id) : bggSearchUrl(g.name)}" target="_blank" rel="noopener noreferrer">
              <span class="game-name">${esc(g.name)}</span>${g.year ? `<span class="game-year">${g.year}</span>` : ''}${icon('arrow', 2)}
              <span class="sr-only">(opens BoardGameGeek)</span>
            </a>
            ${top ? `<span class="top-pick">${icon('star', 2)}<span>Top pick</span></span>` : ''}
            ${voters.length ? `<span class="game-voters"><span class="sr-only">Votes from:</span>${voters.map((id) => avatar(state.players[id].avatar, 20, state.players[id].name)).join('')}</span>` : ''}
            <div class="game-actions">
              <button type="button" class="bring${bringing ? ' is-on' : ''}${canAct ? '' : ' is-locked'}" data-action="bring" data-gk="${esc(k)}" aria-pressed="${bringing}"${locked}>
                ${icon('box', 2)}<span>${bringing ? "I'm bringing it" : "I'll bring it"}</span>
              </button>
              ${bringers.length ? `<span class="game-brings">Brought by ${esc(listNames(bringers))}</span>` : ''}
            </div>
            ${by ? `<span class="game-by">added by ${avatar(by.avatar, 18)} ${esc(by.name)}</span>` : ''}
          </div>
          ${(g.by === state.me && !past) || state.admin.isAdmin ? `<button type="button" class="icon-btn" data-action="remove-game" data-gk="${esc(k)}" aria-label="Remove ${esc(g.name)}">${icon('x', 2)}</button>` : ''}
        </li>`;
  };

  // Game options fold like the other lists (remembered on this device). A short list starts open,
  // a long one closed. Closed, the most-voted game stays on show, with a note about the rest.
  // The rules of the game ("how many players make a game night", who can vote) live behind the ?
  // button instead of taking up room here all the time.
  const foldable = games.length > 0;
  const startOpen = games.length <= 3;
  const open = isOpen('dp-games', startOpen);
  $('#dp-games-head').innerHTML = `
    <div class="head-row">
      ${foldable
    ? `<button type="button" class="fold-head" data-action="toggle-fold" data-fold="dp-games" data-default="${startOpen ? 1 : 0}" aria-expanded="${open}" aria-controls="dp-list"><span class="h-small">Game options <span class="count">${games.length}</span></span>${icon('chevron', 2)}</button>`
    : `<h3 class="h-small">Game options <span class="count">0</span></h3>`}
      <button type="button" class="icon-btn icon-btn--small" data-action="game-night-info" aria-label="How game nights work" title="How game nights work">${icon('help', 2)}</button>
    </div>
    ${canSuggest || past ? '' : '<p class="muted">Ideas open up once someone is available.</p>'}`;

  $('#dp-preview').innerHTML = foldable && !open
    ? `<div class="fold-preview"><ul class="games">${row(ranked[0])}</ul>${ranked.length > 1
      ? `<p class="muted fold-note">+${ranked.length - 1} more. Tap "Game options" to see them all.</p>` : ''}</div>`
    : '';
  $('#dp-list').hidden = foldable && !open;
  $('#dp-list').innerHTML = ranked.length
    ? ranked.map(row).join('')
    : canSuggest && !past ? '<li class="muted">No games yet. Add the first one!</li>' : '';

  $('#dp-add').hidden = !canSuggest || past;
}

async function toggleMe() {
  if (!state.me) return openWho('choose');
  const key = state.openKey;
  if (dayByKey(key)?.isPast) return toast('That day has passed.');
  const mine = savedMine(key);
  try {
    await state.store.setAvailability(state.me, mine ? [] : [key], mine ? [key] : []);
    toast(mine ? 'Removed you from this day' : "You're in!");
  } catch (err) {
    fail(err);
  }
}

function openAdder() {
  if (!state.me) return openWho('choose');
  if (dayByKey(state.openKey)?.isPast) return toast('That day has passed.');
  $('#dp-add-open').hidden = true;
  $('#dp-add-form').hidden = false;
  $('#game-q').focus();
  if (!isLoaded()) {
    state.gamesFailed = false;
    loadGames().then(renderResults).catch(() => { state.gamesFailed = true; renderResults(); });
  }
  renderResults();
}

function closeAdder() {
  const form = $('#dp-add-form');
  if (!form) return;
  form.hidden = true;
  $('#dp-add-open').hidden = false;
  $('#game-q').value = '';
  $('#game-results').innerHTML = '';
}

function resultButton(game, hint = '') {
  return `<li><button type="button" class="result" data-action="add-game" data-id="${game.id ?? ''}" data-name="${esc(game.name)}" data-year="${game.year || ''}">
    <span class="result-name">${esc(game.name)}</span>
    <span class="result-meta">${hint || (game.year ? game.year : '')}</span>
    ${icon('plus', 2)}
  </button></li>`;
}

// My collection: the games I own or love, kept on my profile. Favourites are marked with a star.
const myGames = () => state.players[state.me]?.games ?? [];

function renderResults() {
  const input = $('#game-q');
  if (!input) return;
  const raw = input.value.trim();
  const out = [];
  const count = $('#dp-coll-count');
  if (count) count.textContent = myGames().length || '';

  const link = parseBggLink(raw);
  if (link) {
    const known = findGame(link.id);
    const name = known?.name ?? (link.slug ? titleFromSlug(link.slug) : `BGG game #${link.id}`);
    out.push(resultButton({ id: link.id, name, year: known?.year ?? 0 }, 'from link'));
  } else if (raw.length >= 2) {
    if (isLoaded()) {
      const hits = searchGames(raw);
      hits.forEach((g) => out.push(resultButton(g)));
      if (!hits.length) out.push('<li class="muted">No match in the game list.</li>');
    } else if (state.gamesFailed) {
      out.push("<li class=\"muted\">Couldn't load the game list. You can still add it by name.</li>");
    } else {
      out.push('<li class="muted">Loading the game list…</li>');
    }
    out.push(resultButton({ id: null, name: raw, year: 0 }, 'add by name'));
    out.push(`<li><a class="result result--link" href="${bggSearchUrl(raw)}" target="_blank" rel="noopener noreferrer"><span class="result-name">Look it up on BoardGameGeek</span>${icon('arrow', 2)}</a></li>`);
  }
  $('#game-results').innerHTML = out.join('');
}

async function addGame(game) {
  if (!state.me) return openWho('choose');
  const key = state.openKey;
  if ((state.days[key]?.games ?? []).some((g) => voteKey(g) === voteKey(game))) {
    toast('Already on the list');
    return;
  }
  closeAdder();
  state.folds['dp-games'] = true;                         // open the list, so the new game is on show
  ls.set(FOLDS_KEY, JSON.stringify(state.folds));
  try {
    await state.store.addGame(key, { ...game, by: state.me });
    toast(`Added ${game.name}`);
  } catch (err) {
    fail(err, "Couldn't add the game. Please try again.");
  }
}

async function removeGame(el) {
  const key = state.openKey;
  const game = (state.days[key]?.games ?? []).find(
    (g) => voteKey(g) === el.dataset.gk && (g.by === state.me || state.admin.isAdmin),
  );
  if (!game) return;
  try {
    await state.store.removeGame(key, game);
  } catch (err) {
    fail(err);
  }
}

// ---------------------------------------------------------------------------
// my collection: the games I own or love, kept on my profile. Favourites get a star. "Add game
// from collection" on a day lists them, so there's no need to search for them every time.
// ---------------------------------------------------------------------------

function openMyGames() {
  if (!state.me) return openWho('choose');
  openSheet('My collection', `
    <p class="muted">The games you own or love. Tap the star to mark a favourite; favourites come first. When you add a game to a day, <em>Add game from collection</em> lists them, so you don't have to search every time.</p>
    <div class="field">
      <label class="sr-only" for="mg-q">Search for a game to add</label>
      <input id="mg-q" type="search" placeholder="Search to add a game, or type a name" enterkeyhint="search" spellcheck="false">
      <ul id="mg-results" class="results"></ul>
    </div>
    <section class="block">
      <h3 class="h-small">My games <span id="mg-count" class="count"></span></h3>
      <div id="mg-list"></div>
    </section>
    <div class="row"><button type="button" class="btn btn--solid" data-action="close-dialog">Done</button></div>`);
  renderMyGames();
  renderMyResults();
  if (!isLoaded()) {
    state.gamesFailed = false;
    loadGames().then(renderMyResults).catch(() => { state.gamesFailed = true; renderMyResults(); });
  }
  $('#mg-q').focus();
}

// The star that marks a game as a favourite (or takes the mark off again).
const favButton = (g) => `<button type="button" class="fav-btn${g.fav ? ' is-on' : ''}" data-action="fav-toggle" data-gk="${esc(voteKey(g))}" aria-pressed="${!!g.fav}" aria-label="${g.fav ? `Take ${esc(g.name)} off my favourites` : `Mark ${esc(g.name)} as a favourite`}">${icon(g.fav ? 'star' : 'staroutline', 2)}</button>`;

// The list itself, favourites first, with a star and a remove button on each game. Also keeps
// the count in the profile in step.
function renderMyGames() {
  const games = ordered(myGames());
  const profileCount = $('#who-games-count');
  if (profileCount) profileCount.textContent = games.length;
  const list = $('#mg-list');
  if (!list) return;
  $('#mg-count').textContent = `${games.length} / ${MAX_MY_GAMES}`;
  list.innerHTML = games.length
    ? `<ul class="mygames">${games.map((g) => `
        <li>
          ${favButton(g)}
          <a class="game-link" href="${esc(g.id ? bggUrl(g.id) : bggSearchUrl(g.name))}" target="_blank" rel="noopener noreferrer">
            <span class="game-name">${esc(g.name)}</span>${g.year ? `<span class="game-year">${g.year}</span>` : ''}${icon('arrow', 2)}
            <span class="sr-only">(opens BoardGameGeek)</span>
          </a>
          <button type="button" class="icon-btn icon-btn--small" data-action="mg-remove" data-gk="${esc(voteKey(g))}" aria-label="Remove ${esc(g.name)} from my collection">${icon('x', 2)}</button>
        </li>`).join('')}</ul>`
    : '<p class="muted">Nothing here yet. Search above and tap a game to add it.</p>';
}

// "Add game from collection": everything in my collection, to pick for the open day. Tap a game
// to add it to the day; the star marks a favourite right here too. Games already on that day
// are greyed out.
function openCollection() {
  if (!state.me) return openWho('choose');
  if (dayByKey(state.openKey)?.isPast) return toast('That day has passed.');
  openSheet('Add from my collection', `
    <div id="coll-filter-wrap" class="field">
      <label class="sr-only" for="coll-q">Filter my collection</label>
      <input id="coll-q" type="search" placeholder="Filter my collection" spellcheck="false">
    </div>
    <div id="coll-list"></div>
    <div class="row">
      <button type="button" class="btn" data-action="my-games">${icon('box', 2)} Edit my collection</button>
      <button type="button" class="btn" data-action="close-dialog">Close</button>
    </div>`);
  renderCollection();
  if (myGames().length > 6) $('#coll-q').focus();
}

function renderCollection() {
  const list = $('#coll-list');
  if (!list) return;
  const all = myGames();
  $('#coll-filter-wrap').hidden = all.length <= 6;     // a short list needs no filter
  const q = $('#coll-q').value.trim();
  const onDay = state.days[state.openKey]?.games ?? [];
  const shown = matchMine(all, q);
  list.innerHTML = !all.length
    ? '<p class="muted">Your collection is empty. Use <em>Edit my collection</em> to add the games you own or love, and they\'ll be here next time.</p>'
    : !shown.length
      ? '<p class="muted">No game in your collection matches that.</p>'
      : `<ul class="coll-list">${shown.map((g) => {
        const there = hasGame(onDay, g);
        return `<li class="coll-row${there ? ' is-there' : ''}">
          ${favButton(g)}
          ${there
    ? `<span class="coll-add"><span class="coll-name">${esc(g.name)}</span>${g.year ? `<span class="game-year">${g.year}</span>` : ''}<span class="muted">on this day</span>${icon('check', 2)}</span>`
    : `<button type="button" class="coll-add" data-action="coll-add" data-id="${g.id ?? ''}" data-name="${esc(g.name)}" data-year="${g.year || ''}"><span class="coll-name">${esc(g.name)}</span>${g.year ? `<span class="game-year">${g.year}</span>` : ''}${icon('plus', 2)}</button>`}
        </li>`;
      }).join('')}</ul>`;
}

function renderMyResults() {
  const input = $('#mg-q');
  if (!input) return;
  const raw = input.value.trim();
  const out = [];
  const row = (g, hint = '') => (hasGame(myGames(), g)
    ? `<li><span class="result is-on">${icon('check', 2)}<span class="result-name">${esc(g.name)}</span><span class="result-meta">on your list</span></span></li>`
    : `<li><button type="button" class="result" data-action="mg-add" data-id="${g.id ?? ''}" data-name="${esc(g.name)}" data-year="${g.year || ''}">
        <span class="result-name">${esc(g.name)}</span><span class="result-meta">${esc(hint || g.year || '')}</span>${icon('plus', 2)}
      </button></li>`);
  const link = parseBggLink(raw);
  if (link) {
    const known = findGame(link.id);
    out.push(row({ id: link.id, name: known?.name ?? (link.slug ? titleFromSlug(link.slug) : `BGG game #${link.id}`), year: known?.year ?? 0 }, 'from link'));
  } else if (raw.length >= 2) {
    if (isLoaded()) {
      const hits = searchGames(raw, 6);
      hits.forEach((g) => out.push(row(g)));
      if (!hits.length) out.push('<li class="muted">No match in the game list.</li>');
    } else if (state.gamesFailed) {
      out.push("<li class=\"muted\">Couldn't load the game list. You can still add it by name.</li>");
    } else {
      out.push('<li class="muted">Loading the game list…</li>');
    }
    out.push(row({ id: null, name: raw, year: 0 }, 'add by name'));
  }
  $('#mg-results').innerHTML = out.join('');
}

// Saves the whole list, and shows it straight away rather than waiting for the database to echo it back.
async function saveMyGames(next) {
  await state.store.setPlayerGames(state.me, next);
  if (state.players[state.me]) state.players[state.me] = { ...state.players[state.me], games: next };
  renderMyGames();
  renderCollection();
}

// The star, in "My collection" and in "Add game from collection".
async function toggleFavourite(key) {
  if (!state.me) return;
  try {
    await saveMyGames(toggleFav(myGames(), key));
  } catch (err) {
    fail(err, "Couldn't save that. Please try again.");
  }
}

async function addMyGame(game) {
  if (!state.me) return openWho('choose');
  const next = withGame(myGames(), game);
  if (!next) return toast(hasGame(myGames(), game) ? 'Already on your list' : `Your list is full (${MAX_MY_GAMES} games). Remove one first.`);
  try {
    await saveMyGames(next);
    $('#mg-q').value = '';
    renderMyResults();
    toast(`Saved ${game.name}`);
  } catch (err) {
    fail(err, "Couldn't save that. If this keeps happening, the site owner may need to update the database rules.");
  }
}

async function removeMyGame(key) {
  if (!state.me) return;
  try {
    await saveMyGames(withoutGame(myGames(), key));
    renderMyResults();
  } catch (err) {
    fail(err, "Couldn't remove that. Please try again.");
  }
}

// Tap once to vote for a game, tap again to take the vote back. Vote for as many as you like.
async function vote(el) {
  if (!state.me) return openWho('choose');
  const key = state.openKey;
  if (dayByKey(key)?.isPast) return toast('That day has passed.');
  // Votes decide who plays, so only players who are available that day can cast one.
  if (!savedMine(key)) {
    toast('Mark yourself available this day to vote.');
    return;
  }
  const gk = el.dataset.gk;
  const alreadyVoted = (state.days[key]?.votes?.[gk] ?? []).includes(state.me);
  try {
    await state.store.toggleVote(key, gk, state.me, !alreadyVoted);
  } catch (err) {
    fail(err, "Couldn't save your vote. Please try again.");
  }
}

// "I'll bring it": tap to say you'll bring this game to the game night, tap again to undo.
// Like voting, it's for players who are available that day.
async function bring(el) {
  if (!state.me) return openWho('choose');
  const key = state.openKey;
  if (dayByKey(key)?.isPast) return toast('That day has passed.');
  if (!savedMine(key)) {
    toast('Mark yourself available this day to bring a game.');
    return;
  }
  const gk = el.dataset.gk;
  const already = (state.days[key]?.brings?.[gk] ?? []).includes(state.me);
  try {
    await state.store.toggleBring(key, gk, state.me, !already);
  } catch (err) {
    fail(err, "Couldn't save that. Please try again.");
  }
}

// ---------------------------------------------------------------------------
// where and when, and "Add to calendar"
// ---------------------------------------------------------------------------

function openDetails() {
  if (!state.me) return openWho('choose');
  const key = state.openKey;
  if (dayByKey(key)?.isPast) return toast('That day has passed.');
  const { place = '', time = '' } = state.days[key]?.details ?? {};
  $('#details-dialog').innerHTML = `
    <div class="sheet-head"><h2>Game night details</h2>${closeBtn()}</div>
    <form id="details-form" class="sheet-body" data-date="${esc(key)}" autocomplete="off">
      <label class="field"><span>Where</span>
        <input name="place" maxlength="80" placeholder="e.g. Mia's place, Main Street 5" value="${esc(place)}">
      </label>
      <label class="field"><span>Start time (optional)</span>
        <input name="time" type="time" value="${esc(time)}">
      </label>
      <p class="muted">Everyone can see this. It goes into the reminder and the calendar event.</p>
      <div class="row">
        <button type="button" class="btn" data-action="close-dialog">Cancel</button>
        <button type="submit" class="btn btn--solid">Save</button>
      </div>
    </form>`;
  $('#details-dialog').showModal();
  $('#details-form [name="place"]').focus();
}

async function submitDetails(form) {
  const place = form.elements.place.value.trim().replace(/\s+/g, ' ');
  const time = form.elements.time.value;   // '' or "19:30"
  const submit = form.querySelector('[type="submit"]');
  submit.disabled = true;
  try {
    await state.store.setDetails(form.dataset.date, { place, time });
    $('#details-dialog').close();
    toast('Saved');
  } catch (err) {
    submit.disabled = false;
    fail(err, "Couldn't save the details. Please try again.");
  }
}

// Downloads an .ics file; opening it adds the game night to the phone's or computer's calendar.
function addToCalendar() {
  const day = dayByKey(state.openKey);
  if (!day) return;
  const { place = '', time = '' } = state.days[day.key]?.details ?? {};
  const description = [
    `Available: ${listNames(savedIds(day.key).sort(byName), 99)}`,
    topPickLine(day.key),
    `Details and votes: ${SITE_URL}`,
  ].filter(Boolean).join('\n');
  const file = buildIcs({ key: day.key, date: day.date, place, time, description, url: SITE_URL });
  const url = URL.createObjectURL(new Blob([file], { type: 'text/calendar;charset=utf-8' }));
  const link = Object.assign(document.createElement('a'), { href: url, download: `game-night-${day.key}.ics` });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  toast('Calendar file downloaded');
}

// ---------------------------------------------------------------------------
// log a game night (feeds the hall of fame)
// ---------------------------------------------------------------------------

// Re-draws a group of buttons without dropping keyboard focus from the one just pressed.
function rerender(el, html) {
  const active = el.contains(document.activeElement) ? document.activeElement : null;
  const selector = active
    ? ['action', 'id', 'i'].reduce((s, k) => (active.dataset[k] !== undefined ? `${s}[data-${k}="${CSS.escape(active.dataset[k])}"]` : s), '')
    : null;
  el.innerHTML = html;
  if (selector) el.querySelector(selector)?.focus();
}

// A toggle button; a check mark shows when it's on, so it isn't colour alone.
const choice = (attrs, on, inner, cls = '') => `<button type="button" class="choice ${cls}" aria-pressed="${on}" ${attrs}>${on ? icon('check', 2) : ''}${inner}</button>`;
const sameGame = (a, b) => !!a && !!b && voteKey(a) === voteKey(b);

// `campaignId`: log it as a session of that campaign. `dateEditable`: let the date be chosen
// (when it's opened from the Campaigns tab rather than from a day).
function openLog(key, { campaignId = null, dateEditable = false } = {}) {
  if (!state.me) return openWho('choose');
  const { ranked: ideas, topVotes } = rankGames(key);
  const leaders = ideas.filter((r) => r.voters.length === topVotes);
  const asGame = (g) => ({ id: g.id ?? null, name: g.name, year: g.year || 0 });
  // only campaigns I'm in: anyone in a campaign can log its sessions
  const campaigns = sortCampaigns(state.campaigns).active.filter((c) => myRights(c).log);
  state.log = {
    date: key,
    dateEditable,
    ideas: ideas.map(({ g }) => asGame(g)),
    // if one game clearly won the vote, start with it selected
    game: topVotes > 0 && leaders.length === 1 ? asGame(leaders[0].g) : null,
    defaultGame: topVotes > 0 && leaders.length === 1 ? asGame(leaders[0].g) : null,
    defaultPlayers: [...savedIds(key)],
    players: new Set(savedIds(key)),   // everyone who was available; adjust below
    winner: undefined,                 // undefined: not chosen yet, null: nobody won, otherwise a player id
    campaigns,
    campaignId: null,
    next: undefined,                   // the day chosen for the campaign's next session ('' = not decided)
  };
  // A campaign session planned for that day starts selected, or the one we were asked for.
  const chosen = campaigns.find((c) => c.id === (campaignId ?? plannedOn(campaigns, key)[0]?.id));
  if (chosen) applyCampaignToLog(chosen);

  const when = dateEditable
    ? `<label class="field"><span>When</span>
         <input id="log-date" type="date" min="${esc(state.pastDays[0]?.key ?? key)}" max="${esc(state.daysList[0]?.key ?? key)}" value="${esc(key)}">
       </label>`
    : `<p class="muted">${esc(longLabel(dayByKey(key).date))}. This is saved to the hall of fame for everyone.</p>`;
  $('#log-dialog').innerHTML = `
    <div class="sheet-head"><h2>Log game night</h2>${closeBtn()}</div>
    <form id="log-form" class="sheet-body" autocomplete="off">
      ${when}
      <fieldset id="log-campaign-field" class="field" hidden><legend>Part of a campaign?</legend>
        <div id="log-campaign" class="choices"></div>
      </fieldset>
      <fieldset class="field"><legend>What did you play?</legend>
        <div id="log-game-pick">
          <div id="log-ideas" class="choices"></div>
          <label class="sr-only" for="log-q">Something else</label>
          <input id="log-q" type="search" placeholder="Something else? Search, or type a name" spellcheck="false">
          <ul id="log-results" class="results"></ul>
        </div>
        <p id="log-picked" class="log-picked"></p>
      </fieldset>
      <fieldset class="field"><legend>Who played?</legend><div id="log-players" class="choices"></div></fieldset>
      <fieldset class="field"><legend>Who won?</legend><div id="log-winner" class="choices"></div></fieldset>
      <label id="log-next-field" class="field" hidden><span>Next session (optional)</span>
        <select id="log-next"></select>
        <small class="muted">Pick the day while you're all together. It shows on the calendar for everyone in the campaign.</small>
      </label>
      <label class="field"><span>Note (optional)</span>
        <input id="log-note" maxlength="140" placeholder="e.g. a close finish, or what happened this chapter">
      </label>
      <p id="log-error" class="error" role="alert" hidden></p>
      <div class="row">
        <button type="button" class="btn" data-action="close-dialog">Cancel</button>
        <button type="submit" class="btn btn--solid">Log it</button>
      </div>
    </form>`;
  renderLogCampaign();
  renderLogGame();
  renderLogPlayers();
  renderLogWinner();
  renderLogNext();
  $('#log-dialog').showModal();
}

// Picking a campaign fixes the game and starts the players from the campaign's own.
function applyCampaignToLog(campaign) {
  const L = state.log;
  L.campaignId = campaign.id;
  L.next = undefined;
  L.game = { id: campaign.game.id ?? null, name: campaign.game.name, year: campaign.game.year || 0 };
  L.players = new Set(campaign.players.filter((id) => state.players[id]));
  if (L.winner && !L.players.has(L.winner)) L.winner = undefined;
}

function renderLogCampaign() {
  const { campaigns, campaignId } = state.log;
  $('#log-campaign-field').hidden = !campaigns.length;
  rerender($('#log-campaign'), campaigns.length
    ? choice('data-action="log-campaign" data-id=""', !campaignId, '<span>No, a normal game night</span>')
      + campaigns.map((c) => choice(`data-action="log-campaign" data-id="${esc(c.id)}"`, campaignId === c.id, `<span>${esc(c.title)}</span>`)).join('')
    : '');
}

// The days a campaign's next session can be on: after the day being logged, within the calendar.
// Starts on the session that is already planned, if it is still ahead.
function renderLogNext() {
  const L = state.log;
  const campaign = L.campaignId ? state.campaigns.find((c) => c.id === L.campaignId) : null;
  $('#log-next-field').hidden = !campaign;
  if (!campaign) return;
  const days = state.daysList.filter((d) => d.key > L.date);
  if (L.next === undefined) L.next = days.some((d) => d.key === campaign.next) ? campaign.next : '';
  if (L.next && !days.some((d) => d.key === L.next)) L.next = '';
  $('#log-next').innerHTML = `<option value="">Not decided yet</option>${days.map((d) => {
    const inCount = campaign.players.filter((pid) => savedIds(d.key).includes(pid)).length;
    const when = d.date.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
    return `<option value="${esc(d.key)}"${L.next === d.key ? ' selected' : ''}>${when} · ${inCount}/${campaign.players.length} available</option>`;
  }).join('')}`;
}

function renderLogGame() {
  const { ideas, game, campaignId } = state.log;
  const campaign = campaignId ? state.campaigns.find((c) => c.id === campaignId) : null;
  $('#log-game-pick').hidden = !!campaign;   // the campaign decides the game
  rerender($('#log-ideas'), ideas.length
    ? ideas.map((g, i) => choice(`data-action="log-idea" data-i="${i}"`, sameGame(game, g), `<span>${esc(g.name)}</span>${g.year ? `<em>${g.year}</em>` : ''}`)).join('')
    : '<p class="muted">Nobody suggested a game for this day, so search for what you played.</p>');
  $('#log-picked').innerHTML = campaign
    ? `Campaign game: <strong>${esc(game.name)}</strong> · session ${sessionsOf(state.plays, campaign.id).length + 1}`
    : game
      ? `Playing: <strong>${esc(game.name)}</strong>`
      : '<span class="muted">Choose a game above, or search for another.</span>';
}

function renderLogPlayers() {
  const { players } = state.log;
  rerender($('#log-players'), sortedPlayers().map((p) => choice(
    `data-action="log-player" data-id="${esc(p.id)}" style="--h:${hueOf(p.avatar)}"`,
    players.has(p.id),
    `${avatar(p.avatar, 24)}<span>${esc(p.name)}</span>`,
    'choice--player',
  )).join(''));
}

function renderLogWinner() {
  const { players, winner } = state.log;
  const who = sortedPlayers().filter((p) => players.has(p.id));
  rerender($('#log-winner'), who.map((p) => choice(
    `data-action="log-winner" data-id="${esc(p.id)}" style="--h:${hueOf(p.avatar)}"`,
    winner === p.id,
    `${avatar(p.avatar, 24)}<span>${esc(p.name)}</span>`,
    'choice--player',
  )).join('') + choice('data-action="log-winner" data-id=""', winner === null, '<span>Nobody (co-op or draw)</span>'));
}

const logResult = (g, hint = '') => `<li><button type="button" class="result" data-action="log-pick-game" data-id="${g.id ?? ''}" data-name="${esc(g.name)}" data-year="${g.year || ''}">
  <span class="result-name">${esc(g.name)}</span><span class="result-meta">${esc(hint || g.year || '')}</span>${icon('check', 2)}
</button></li>`;

function renderLogResults() {
  const input = $('#log-q');
  if (!input) return;
  const raw = input.value.trim();
  const out = [];
  if (raw.length >= 2) {
    if (isLoaded()) searchGames(raw, 6).forEach((g) => out.push(logResult(g)));
    else {
      out.push('<li class="muted">Loading the game list…</li>');
      loadGames().then(renderLogResults).catch(() => {});
    }
    out.push(logResult({ id: null, name: raw, year: 0 }, 'use as typed'));
  }
  $('#log-results').innerHTML = out.join('');
}

async function submitLog(form) {
  const L = state.log;
  const error = $('#log-error');
  const complain = (message) => { error.textContent = message; error.hidden = false; };
  const today = state.daysList[0]?.key;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(L.date)) return complain('Choose the date.');
  if (today && L.date > today) return complain("That date hasn't happened yet.");
  if (!L.game) return complain('Choose the game you played.');
  if (!L.players.size) return complain('Tick the players who took part.');
  if (L.winner === undefined) return complain('Choose who won, or "Nobody" for a co-op game or a draw.');

  const ids = sortedPlayers().filter((p) => L.players.has(p.id)).map((p) => p.id);
  const play = {
    date: L.date,
    game: { id: L.game.id ?? null, name: L.game.name, year: L.game.year || 0 },
    winner: L.winner,
    players: ids,
    names: Object.fromEntries(ids.map((id) => [id, state.players[id].name])),   // so history survives renames and removals
    loggedBy: state.me,
  };
  const note = $('#log-note').value.trim().replace(/\s+/g, ' ');
  if (note) play.note = note;
  if (L.campaignId) play.campaign = L.campaignId;

  const submit = form.querySelector('[type="submit"]');
  submit.disabled = true;
  try {
    await state.store.logPlay(play);
    // The session that was planned for this day (or earlier) is done now. Whatever day was chosen
    // for the next one takes its place.
    const campaign = L.campaignId ? state.campaigns.find((c) => c.id === L.campaignId) : null;
    let next = '';
    if (campaign) {
      next = L.next ?? (campaign.next > L.date ? campaign.next : '');
      if (next !== (campaign.next ?? '')) {
        await state.store.updateCampaign(campaign.id, { next }).catch((err) => console.warn('Could not save the next session:', err));
      }
    }
    $('#log-dialog').close();
    if ($('#day-dialog').open) $('#day-dialog').close();
    toast(campaign ? `Session logged!${next ? ` Next: ${dateLabel(next)}` : ''}` : 'Game night logged!');
    location.hash = campaign ? '#campaigns' : '#hall';
    if (location.hash === (campaign ? '#campaigns' : '#hall')) renderAll();
  } catch (err) {
    submit.disabled = false;
    fail(err, "Couldn't log it. If this keeps happening, the site owner may need to update the database rules.");
  }
}

// Admin only: take a mistaken entry out of the hall of fame.
function deletePlay(id) {
  const play = state.plays.find((p) => p.id === id);
  if (!play || !state.admin.isAdmin) return;
  askConfirm({
    title: 'Remove this entry?',
    message: `${play.game.name} on ${dateLabel(play.date)} will be removed from the hall of fame.`,
    label: 'Remove',
  }, async () => {
    await state.store.deletePlay(id);
    toast('Entry removed');
  });
}

// ---------------------------------------------------------------------------
// campaigns: long games played over several sessions (Arcs, Oath, ...)
// ---------------------------------------------------------------------------

function sessionRow(play, number) {
  return `
    <li class="session">
      <span class="session-n" aria-label="Session ${number}">${number}</span>
      <div class="session-body">
        <strong>${esc(dateLabel(play.date))}</strong>
        ${play.note ? `<p class="play-note">${esc(play.note)}</p>` : ''}
      </div>
    </li>`;
}

const campaignBtn = (action, c, inner, cls = '') => `<button type="button" class="btn ${cls}" data-action="${action}" data-id="${esc(c.id)}">${inner}</button>`;

function campaignCard(c) {
  const sessions = sessionsOf(state.plays, c.id);
  const finished = c.status === 'finished';
  const rights = myRights(c);
  const g = c.game ?? {};
  const list = [...sessions].reverse().map((p) => sessionRow(p, sessions.indexOf(p) + 1));
  const iAmIn = !!state.me && c.players.includes(state.me);

  // Who is in, and who may still join.
  const joinState = finished ? '' : c.locked
    ? `<span class="camp-state is-locked">${icon('lock', 2)}<span>Locked</span></span>`
    : `<span class="camp-state">${icon('unlock', 2)}<span>Open to join</span></span>`;
  const joinHint = finished || iAmIn || rights.join ? ''
    : `<p class="muted camp-hint">${c.locked ? `Locked: only ${esc(playerName(c.createdBy))} can add players now.` : ''}</p>`;
  const peopleButtons = [
    rights.join ? campaignBtn('campaign-join', c, `${icon('plus', 2)} Join`, 'btn--solid') : '',
    rights.manage ? campaignBtn('campaign-add', c, `${icon('plus', 2)} Add players`) : '',
    rights.manage ? campaignBtn('campaign-lock', c, c.locked ? `${icon('unlock', 2)} Unlock` : `${icon('lock', 2)} Lock, everyone's in`) : '',
    rights.leave ? campaignBtn('campaign-leave', c, 'Leave', 'btn--small') : '',
  ].join('');
  const playButtons = [
    rights.log ? campaignBtn('campaign-log', c, `${icon('plus', 2)} Log session`, 'btn--solid') : '',
    rights.plan ? campaignBtn('campaign-plan', c, `${icon('calendar', 2)} ${c.next ? 'Change next session' : 'Plan next session'}`) : '',
    rights.manage ? campaignBtn('campaign-finish', c, `${icon('flag', 2)} Finish`) : '',
    rights.reopen ? campaignBtn('campaign-reopen', c, `${icon('unlock', 2)} Reopen`) : '',
  ].join('');

  return `
    <li id="campaign-${esc(c.id)}" class="campaign${finished ? ' is-finished' : ''}">
      <div class="campaign-head">
        <h3 class="campaign-title">${esc(c.title)}</h3>
        <a class="game-link" href="${esc(g.id ? bggUrl(g.id) : bggSearchUrl(g.name))}" target="_blank" rel="noopener noreferrer">
          <span class="game-name">${esc(g.name)}</span>${g.year ? `<span class="game-year">${g.year}</span>` : ''}${icon('arrow', 2)}
          <span class="sr-only">(opens BoardGameGeek)</span>
        </a>
        ${finished ? `<span class="camp-state is-done">${icon('check', 2)}<span>Finished</span></span>` : joinState}
      </div>
      <p class="campaign-meta">
        ${plural(sessions.length, 'session')}${sessions.length ? ` · last played ${esc(dateLabel(sessions.at(-1).date))}` : ' · not played yet'}${
  finished ? ` · finished ${esc(dateLabel(c.finishedAt))}` : c.next ? ` · <strong>next: ${esc(dateLabel(c.next))}</strong>` : ''}
        · started by ${esc(playerName(c.createdBy))}
      </p>
      ${finished ? `<p class="campaign-result">${icon('trophy', 2)} ${c.winner ? `Won by ${playerPill(c.winner)}` : 'Finished, with no single winner'}</p>` : ''}
      <div class="pill-row">${c.players.map((id) => playerPill(id)).join('')}</div>
      ${joinHint}
      ${playButtons ? `<div class="actions">${playButtons}</div>` : ''}
      ${peopleButtons ? `<div class="actions">${peopleButtons}</div>` : ''}
      ${list.length ? fold(`sessions-${c.id}`, 'Sessions', { count: list.length, open: false, body: `<ul class="sessions">${list.join('')}</ul>` }) : ''}
      ${rights.remove ? `<button type="button" class="btn btn--small" data-action="campaign-delete" data-id="${esc(c.id)}">Remove campaign</button>` : ''}
    </li>`;
}

function renderCampaigns() {
  const body = $('#campaigns-body');
  const count = $('#campaigns-count');
  count.textContent = '';
  if (state.campaignsError) {
    body.innerHTML = "<p class=\"muted\">Campaigns can't be loaded right now. (Site owner: publish the updated Firestore rules from the README.)</p>";
    return;
  }
  if (!state.campaignsReady) {
    body.innerHTML = '<p class="loading">Loading…</p>';
    return;
  }
  const { active, finished } = sortCampaigns(state.campaigns);
  count.textContent = `${active.length} running · ${finished.length} finished`;
  // While "Running campaigns" is collapsed, each one still shows its next day.
  const runningPreview = `<div class="fold-preview"><ul class="camp-mini">${active.map((c) => `
    <li><strong>${esc(c.title)}</strong><span class="muted">${c.next ? `next: ${esc(dateLabel(c.next))}` : 'no next day yet'}</span></li>`).join('')}</ul></div>`;
  body.innerHTML = `
    <div class="campaigns-intro">
      <p>Long games that take several sessions, like Arcs or Oath. Start one and others can join until you lock it. Anyone in it logs the sessions and picks the next day.</p>
      <button type="button" class="btn btn--solid" data-action="start-campaign">${icon('plus', 2)} Start a campaign</button>
    </div>
    ${active.length
    ? fold('running-campaigns', 'Running campaigns', {
      count: active.length, preview: runningPreview, body: `<ul class="campaign-list">${active.map(campaignCard).join('')}</ul>`,
    })
    : '<p class="muted">No running campaigns yet.</p>'}
    ${finished.length ? fold('finished-campaigns', 'Finished campaigns', {
    count: finished.length, open: false, body: `<ul class="campaign-list">${finished.map(campaignCard).join('')}</ul>`,
  }) : ''}`;
}

// --- start a campaign ---

function openStartCampaign() {
  if (!state.me) return openWho('choose');
  state.start = { game: null, players: new Set([state.me]) };
  $('#campaign-dialog').innerHTML = `
    <div class="sheet-head"><h2>Start a campaign</h2>${closeBtn()}</div>
    <form id="campaign-form" class="sheet-body" autocomplete="off">
      <fieldset class="field"><legend>Which game?</legend>
        <label class="sr-only" for="camp-q">Search for the game</label>
        <input id="camp-q" type="search" placeholder="Search, or type a name" spellcheck="false">
        <ul id="camp-results" class="results"></ul>
        <p id="camp-picked" class="log-picked"></p>
      </fieldset>
      <label class="field"><span>Name (optional)</span>
        <input id="camp-title" maxlength="80" placeholder="e.g. Arcs: the long game">
      </label>
      <fieldset class="field"><legend>Who's in?</legend>
        <div id="camp-players" class="choices"></div>
        <small class="muted">Others can join later until you lock the campaign, and you can add people after that.</small>
      </fieldset>
      <p id="camp-error" class="error" role="alert" hidden></p>
      <div class="row">
        <button type="button" class="btn" data-action="close-dialog">Cancel</button>
        <button type="submit" class="btn btn--solid">Start</button>
      </div>
    </form>`;
  renderCampGame();
  renderCampPlayers();
  $('#campaign-dialog').showModal();
  $('#camp-q').focus();
}

function renderCampGame() {
  const { game } = state.start;
  $('#camp-picked').innerHTML = game
    ? `Game: <strong>${esc(game.name)}</strong>`
    : '<span class="muted">Search for the game, then choose it from the list.</span>';
}

function renderCampPlayers() {
  const { players } = state.start;
  rerender($('#camp-players'), sortedPlayers().map((p) => choice(
    `data-action="camp-player" data-id="${esc(p.id)}" style="--h:${hueOf(p.avatar)}"`,
    players.has(p.id),
    `${avatar(p.avatar, 24)}<span>${esc(p.name)}</span>`,
    'choice--player',
  )).join(''));
}

function renderCampResults() {
  const input = $('#camp-q');
  if (!input) return;
  const raw = input.value.trim();
  const out = [];
  if (raw.length >= 2) {
    const result = (g, hint = '') => `<li><button type="button" class="result" data-action="camp-pick-game" data-id="${g.id ?? ''}" data-name="${esc(g.name)}" data-year="${g.year || ''}">
      <span class="result-name">${esc(g.name)}</span><span class="result-meta">${esc(hint || g.year || '')}</span>${icon('check', 2)}
    </button></li>`;
    if (isLoaded()) searchGames(raw, 6).forEach((g) => out.push(result(g)));
    else {
      out.push('<li class="muted">Loading the game list…</li>');
      loadGames().then(renderCampResults).catch(() => {});
    }
    out.push(result({ id: null, name: raw, year: 0 }, 'use as typed'));
  }
  $('#camp-results').innerHTML = out.join('');
}

async function submitStartCampaign(form) {
  const { game, players } = state.start;
  const error = $('#camp-error');
  const complain = (message) => { error.textContent = message; error.hidden = false; };
  if (!game) return complain('Choose the game first.');
  players.add(state.me);   // whoever starts a campaign is in it, and runs it
  const ids = sortedPlayers().filter((p) => players.has(p.id)).map((p) => p.id);
  const title = $('#camp-title').value.trim().replace(/\s+/g, ' ') || defaultTitle(game);
  const submit = form.querySelector('[type="submit"]');
  submit.disabled = true;
  try {
    await state.store.createCampaign({
      game: { id: game.id ?? null, name: game.name, year: game.year || 0 },
      title,
      players: ids,
      names: Object.fromEntries(ids.map((id) => [id, state.players[id].name])),
      status: 'active',
      locked: false,
      startedAt: state.daysList[0].key,
      next: '',
      finishedAt: '',
      winner: null,
      createdBy: state.me,
    });
    $('#campaign-dialog').close();
    toast('Campaign started!');
  } catch (err) {
    submit.disabled = false;
    fail(err, "Couldn't start the campaign. If this keeps happening, the site owner may need to update the database rules.");
  }
}

// --- plan the next session, finish, remove ---

// A small popup in the shared "form" dialog.
function openSheet(title, html) {
  $('#form-dialog').innerHTML = `
    <div class="sheet-head"><h2>${esc(title)}</h2>${closeBtn()}</div>
    <div class="sheet-body">${html}</div>`;
  if (!$('#form-dialog').open) $('#form-dialog').showModal();
}

function openPlan(id) {
  const c = state.campaigns.find((x) => x.id === id);
  if (!c) return;
  if (!myRights(c).plan) return toast('Only people in the campaign can plan sessions.');
  const days = state.daysList.map((d) => {
    const inCount = c.players.filter((pid) => savedIds(d.key).includes(pid)).length;
    return choice(
      `data-action="campaign-set-next" data-id="${esc(c.id)}" data-date="${esc(d.key)}"`,
      c.next === d.key,
      `<span>${d.dow} ${d.num} ${d.month}</span><em>${inCount}/${c.players.length} available</em>`,
    );
  }).join('');
  openSheet(`Next session: ${c.title}`, `
    <p class="muted">Pick a day. It shows on the calendar, and you can log the session from there.</p>
    <div class="choices">${days}</div>
    <div class="row">
      ${c.next ? `<button type="button" class="btn" data-action="campaign-set-next" data-id="${esc(c.id)}" data-date="">Clear the date</button>` : ''}
      <button type="button" class="btn btn--solid" data-action="close-dialog">Done</button>
    </div>`);
}

async function setNext(id, date) {
  try {
    await state.store.updateCampaign(id, { next: date });
    $('#form-dialog').close();
    toast(date ? `Next session: ${dateLabel(date)}` : 'Date cleared');
  } catch (err) {
    fail(err, "Couldn't save that. Please try again.");
  }
}

function openFinish(id) {
  const c = state.campaigns.find((x) => x.id === id);
  if (!c) return;
  if (!myRights(c).manage) return toast(`Only ${playerName(c.createdBy)} can finish this campaign.`);
  state.finish = { id, winner: undefined };
  renderFinish();
}

function renderFinish() {
  const { id, winner } = state.finish;
  const c = state.campaigns.find((x) => x.id === id);
  const who = c.players.filter((pid) => state.players[pid]).map((pid) => state.players[pid]);
  openSheet(`Finish: ${c.title}`, `
    <p>Who won the campaign?</p>
    <div class="choices">
      ${who.map((p) => choice(`data-action="campaign-winner" data-id="${esc(p.id)}" style="--h:${hueOf(p.avatar)}"`, winner === p.id, `${avatar(p.avatar, 24)}<span>${esc(p.name)}</span>`, 'choice--player')).join('')}
      ${choice('data-action="campaign-winner" data-id=""', winner === null, '<span>Nobody in particular (co-op or draw)</span>')}
    </div>
    <p class="muted">The sessions stay in the hall of fame. A finished campaign is closed: nobody can join it or log sessions. You can reopen it later if you play on.</p>
    <div class="row">
      <button type="button" class="btn" data-action="close-dialog">Cancel</button>
      <button type="button" class="btn btn--solid" data-action="campaign-finish-confirm"${winner === undefined ? ' disabled' : ''}>Finish campaign</button>
    </div>`);
}

async function confirmFinish() {
  const { id, winner } = state.finish;
  if (winner === undefined) return;
  try {
    await state.store.updateCampaign(id, { status: 'finished', finishedAt: state.daysList[0].key, winner, next: '' });
    $('#form-dialog').close();
    toast('Campaign finished!');
  } catch (err) {
    fail(err, "Couldn't finish the campaign. Please try again.");
  }
}

// A finished campaign can be taken back to the running list by its creator (say it ended too
// early, or you decided to play on). The winner and finish date are cleared; the sessions,
// the people and the lock stay as they were.
function openReopen(id) {
  const c = state.campaigns.find((x) => x.id === id);
  if (!c) return;
  if (!myRights(c).reopen) return toast(`Only ${playerName(c.createdBy)} can reopen this campaign.`);
  openSheet(`Reopen: ${c.title}`, `
    <p>It goes back to the running campaigns, so you can log sessions again.${c.winner ? ` ${esc(playerName(c.winner))} is no longer its winner, until you finish it again.` : ''}</p>
    <div class="row">
      <button type="button" class="btn" data-action="close-dialog">Cancel</button>
      <button type="button" class="btn btn--solid" data-action="campaign-reopen-confirm" data-id="${esc(c.id)}">Reopen campaign</button>
    </div>`);
}

async function confirmReopen(id) {
  const c = state.campaigns.find((x) => x.id === id);
  if (!c || !myRights(c).reopen) return;
  try {
    await state.store.updateCampaign(id, { status: 'active', finishedAt: '', winner: null });
    $('#form-dialog').close();
    toast('Campaign reopened');
    showCampaign(id);
  } catch (err) {
    fail(err, "Couldn't reopen the campaign. Please try again.");
  }
}

// --- who is in: join, leave, lock, add people ---

async function joinCampaign(id) {
  if (!state.me) return openWho('choose');
  const c = state.campaigns.find((x) => x.id === id);
  if (!c || !myRights(c).join) return toast(c?.locked ? 'This campaign is locked.' : "You can't join this one.");
  try {
    await state.store.addCampaignPlayers(id, [{ id: state.me, name: state.players[state.me].name }]);
    toast(`You joined ${c.title}`);
  } catch (err) {
    fail(err, "Couldn't join. Please try again.");
  }
}

async function leaveCampaign(id) {
  const c = state.campaigns.find((x) => x.id === id);
  if (!c || !myRights(c).leave) return;
  try {
    await state.store.removeCampaignPlayer(id, state.me);
    toast(`You left ${c.title}`);
  } catch (err) {
    fail(err, "Couldn't leave. Please try again.");
  }
}

// Locking closes the door to joining. The creator can still add people, and can unlock again.
async function toggleLock(id) {
  const c = state.campaigns.find((x) => x.id === id);
  if (!c || !myRights(c).manage) return;
  const lock = !c.locked;
  try {
    await state.store.updateCampaign(id, { locked: lock });
    toast(lock ? 'Locked: only you can add players now' : 'Unlocked: anyone can join');
  } catch (err) {
    fail(err, "Couldn't change that. Please try again.");
  }
}

function openAddPlayers(id) {
  const c = state.campaigns.find((x) => x.id === id);
  if (!c || !myRights(c).manage) return;
  state.addPeople = { id, picks: new Set() };
  renderAddPlayers();
}

function renderAddPlayers() {
  const { id, picks } = state.addPeople;
  const c = state.campaigns.find((x) => x.id === id);
  if (!c) return;
  const others = outsiders(c, sortedPlayers());
  openSheet(`Add players: ${c.title}`, others.length ? `
    <p class="muted">Tick who to add. They're in straight away, even if the campaign is locked.</p>
    <div class="choices">${others.map((p) => choice(
    `data-action="campaign-add-pick" data-id="${esc(p.id)}" style="--h:${hueOf(p.avatar)}"`,
    picks.has(p.id),
    `${avatar(p.avatar, 24)}<span>${esc(p.name)}</span>`,
    'choice--player',
  )).join('')}</div>
    <div class="row">
      <button type="button" class="btn" data-action="close-dialog">Cancel</button>
      <button type="button" class="btn btn--solid" data-action="campaign-add-confirm"${picks.size ? '' : ' disabled'}>Add ${picks.size ? plural(picks.size, 'player') : ''}</button>
    </div>` : `
    <p>Everyone is already in this campaign.</p>
    <div class="row"><button type="button" class="btn btn--solid" data-action="close-dialog">OK</button></div>`);
}

async function confirmAddPlayers() {
  const { id, picks } = state.addPeople;
  const c = state.campaigns.find((x) => x.id === id);
  if (!c || !myRights(c).manage || !picks.size) return;
  const people = sortedPlayers().filter((p) => picks.has(p.id)).map((p) => ({ id: p.id, name: p.name }));
  try {
    await state.store.addCampaignPlayers(id, people);
    $('#form-dialog').close();
    toast(`Added ${listNames(people.map((p) => p.id))}`);
  } catch (err) {
    fail(err, "Couldn't add them. Please try again.");
  }
}

// The creator (or a signed-in admin) can remove a campaign, running or finished. The sessions
// stay in the hall of fame.
function deleteCampaign(id) {
  const c = state.campaigns.find((x) => x.id === id);
  if (!c) return;
  if (!myRights(c).remove && !adminOn) return toast(`Only ${playerName(c.createdBy)} can remove this campaign.`);
  askConfirm({
    title: `Remove ${c.title}?`,
    message: `The campaign disappears for everyone, and this can't be undone. Its ${plural(sessionsOf(state.plays, id).length, 'session')} stay in the hall of fame.`,
    label: 'Remove',
    failMessage: "Couldn't remove the campaign. Please try again.",
  }, async () => {
    await state.store.deleteCampaign(id);
    toast('Campaign removed');
  });
}

// ---------------------------------------------------------------------------
// player cards
// ---------------------------------------------------------------------------

function openPlayerCard(id) {
  const player = state.players[id];
  if (!player) return;
  let body;
  if (state.playsError) {
    body = '<p class="muted">The stats can\'t be loaded right now.</p>';
  } else if (!state.playsReady) {
    body = '<p class="loading">Loading…</p>';
  } else {
    const s = playerStats(state.plays, id);
    const titles = awardTitles(state.plays).get(id) ?? [];
    const record = campaignRecord(state.campaigns, id);
    if (record.won > 0) titles.push('Campaign victor');
    body = s.games === 0 ? '<p class="muted">No games logged yet. They show up here after the first logged game night.</p>' : `
      ${titles.length ? `<div class="titles">${titles.map((t) => `<span class="title-tag">${icon('trophy', 2)}<span>${esc(t)}</span></span>`).join('')}</div>` : ''}
      <dl class="stats">
        <div><dt>Wins</dt><dd>${s.wins}</dd></div>
        <div><dt>Win rate</dt><dd>${s.winRate === null ? '–' : `${Math.round(s.winRate * 100)}%`}</dd></div>
        <div><dt>Games</dt><dd>${s.games}</dd></div>
        <div><dt>Game nights</dt><dd>${s.nights}</dd></div>
      </dl>
      <ul class="facts">
        ${s.favourite ? `<li>Favourite game: <strong>${esc(s.favourite.name)}</strong> <span class="muted">(${plural(s.favourite.n, 'play')})</span></li>` : ''}
        ${s.bestAt ? `<li>Best at: <strong>${esc(s.bestAt.name)}</strong> <span class="muted">(${plural(s.bestAt.n, 'win')})</span></li>` : ''}
        ${record.played ? `<li>Campaigns: <strong>${record.played}</strong> played, <strong>${record.won}</strong> won</li>` : ''}
        ${s.contested < s.games ? `<li class="muted">Win rate only counts games that had a winner.</li>` : ''}
      </ul>
      <div>
        <h3 class="h-small">Recent games</h3>
        <ul class="recent">${s.recent.map((r) => `
          <li><span class="muted">${esc(dateLabel(r.date))}</span> <strong>${esc(r.game)}</strong>${r.campaign ? ` ${icon('flag', 2)}` : ''} <span class="result-${r.result === 'won' ? 'won' : 'other'}">${esc(r.result)}</span></li>`).join('')}
        </ul>
      </div>`;
  }
  // Their collection (see "My collection"), favourites first and starred. A short list starts
  // open; a long one starts closed, so it doesn't push the stats off the card.
  const theirs = ordered(player.games ?? []);
  const mineCard = id === state.me;
  const gamesBlock = `
    <details class="card-games"${theirs.length <= 8 ? ' open' : ''}>
      <summary><span class="h-small">Collection</span> <span class="count">${theirs.length}</span>${icon('chevron', 2)}</summary>
      ${theirs.length
    ? `<ul class="game-chips">${theirs.map((g) => `<li><a class="game-chip${g.fav ? ' is-fav' : ''}" href="${esc(g.id ? bggUrl(g.id) : bggSearchUrl(g.name))}" target="_blank" rel="noopener noreferrer">${g.fav ? `${icon('star', 2)}<span class="sr-only">Favourite: </span>` : ''}${esc(g.name)}${g.year ? ` <span class="game-year">${g.year}</span>` : ''}<span class="sr-only">(opens BoardGameGeek)</span></a></li>`).join('')}</ul>`
    : `<p class="muted">${mineCard ? "You haven't added any games yet." : `${esc(player.name)} hasn't added any games yet.`}</p>`}
      ${mineCard ? '<button type="button" class="link-btn" data-action="my-games">Edit my collection</button>' : ''}
    </details>`;
  $('#player-dialog').innerHTML = `
    <div class="sheet-head"><h2>Player card</h2>${closeBtn()}</div>
    <div class="sheet-body">
      <div class="card-head" style="--h:${hueOf(player.avatar)}">
        ${avatar(player.avatar, 64)}
        <span class="card-name">${esc(player.name)}${mineCard ? ' <em>(you)</em>' : ''}</span>
      </div>
      ${gamesBlock}
      ${body}
    </div>`;
  $('#player-dialog').showModal();
}

// ---------------------------------------------------------------------------
// admin page: the owner's overview and tools. Only admins see it (see viewFromHash), and the
// database rules only let an admin edit or remove a hall-of-fame entry or remove a player.
// ---------------------------------------------------------------------------

const ADMIN_PLAYS_SHOWN = 25;

const gameLink = (g) => `<a class="game-link" href="${esc(g.id ? bggUrl(g.id) : bggSearchUrl(g.name))}" target="_blank" rel="noopener noreferrer">
  <span class="game-name">${esc(g.name)}</span>${g.year ? `<span class="game-year">${g.year}</span>` : ''}${icon('arrow', 2)}
  <span class="sr-only">(opens BoardGameGeek)</span></a>`;

function adminPlayers() {
  const list = sortedPlayers();
  if (!list.length) return '<p class="muted">Nobody has joined yet.</p>';
  if (state.adminSelected && !state.players[state.adminSelected]) state.adminSelected = null;
  const days = state.daysList.length;
  return `
    <p class="muted">Tap a player to see their details. Removing someone is done from there.</p>
    <ul class="adm-list">${list.map((p) => {
    const open = p.id === state.adminSelected;
    const upcoming = state.daysList.filter((d) => savedIds(d.key).includes(p.id)).length;
    const camps = state.campaigns.filter((c) => c.players?.includes(p.id));
    const s = state.playsReady ? playerStats(state.plays, p.id) : null;
    return `
      <li class="adm-player${open ? ' is-selected' : ''}" style="--h:${hueOf(p.avatar)}">
        <button type="button" class="adm-player-head" data-action="admin-select" data-id="${esc(p.id)}" aria-expanded="${open}">
          ${avatar(p.avatar, 32)}<span class="adm-player-name">${esc(p.name)}</span>
          <span class="adm-sub">${plural((p.games ?? []).length, 'game')} in collection</span>
          ${icon('chevron', 2)}
        </button>
        ${open ? `
        <div class="adm-player-detail">
          <ul class="facts">
            <li>Available on <strong>${upcoming}</strong> of the next ${days} days</li>
            <li>${plural((p.games ?? []).length, 'game')} in their collection</li>
            <li>In ${plural(camps.length, 'campaign')}${camps.length ? `: ${esc(camps.map((c) => c.title).join(', '))}` : ''}</li>
            ${s ? `<li>${plural(s.games, 'logged game')}, ${plural(s.wins, 'win')}</li>` : ''}
          </ul>
          <p class="muted">Removing ${esc(p.name)} takes them out of the group and off every day they picked. Their logged games stay in the hall of fame, under the name they had.</p>
          <div class="actions">
            <button type="button" class="btn btn--small" data-action="player-card" data-id="${esc(p.id)}">Player card</button>
            <button type="button" class="btn btn--small btn--danger" data-action="delete-player" data-id="${esc(p.id)}">${icon('x', 2)} Remove ${esc(p.name)}</button>
          </div>
        </div>` : ''}
      </li>`;
  }).join('')}</ul>`;
}

function adminCampaigns() {
  if (state.campaignsError) return '<p class="muted">Campaigns can\'t be loaded right now.</p>';
  const { active, finished } = sortCampaigns(state.campaigns);
  const all = [...active, ...finished];
  if (!all.length) return '<p class="muted">No campaigns yet.</p>';
  return `<ul class="adm-list">${all.map((c) => `
    <li class="adm-row">
      <div class="adm-main">
        <strong>${esc(c.title)}</strong>
        <span class="adm-sub">${esc(c.game.name)} · ${c.status === 'finished' ? 'finished' : c.locked ? 'running, locked' : 'running, open to join'} · ${plural(c.players.length, 'player')} · started by ${esc(playerName(c.createdBy))}${c.status !== 'finished' && c.next ? ` · next: ${esc(dateLabel(c.next))}` : ''}</span>
      </div>
      <div class="adm-actions">
        <button type="button" class="btn btn--small" data-action="open-campaign" data-id="${esc(c.id)}">See ${icon('arrow', 2)}</button>
        <button type="button" class="btn btn--small" data-action="campaign-delete" data-id="${esc(c.id)}">${icon('x', 2)} Remove</button>
      </div>
    </li>`).join('')}</ul>`;
}

function adminUpcomingGames() {
  const days = state.daysList.filter((d) => (state.days[d.key]?.games ?? []).length);
  if (!days.length) return '<p class="muted">Nobody has suggested a game for the next two weeks yet.</p>';
  return `<div class="adm-list">${days.map((d) => `
    <div class="adm-day">
      <div class="adm-day-head"><span>${esc(longLabel(d.date))}${d.isToday ? ' (today)' : ''}</span>
        <button type="button" class="btn btn--small" data-action="open-day" data-date="${d.key}">Open</button></div>
      <ul class="adm-games">${rankGames(d.key).ranked.map(({ g, voters }) => `
        <li>${gameLink(g)}
          <span class="adm-sub">${plural(voters.length, 'vote')}${g.by ? ` · added by ${esc(playerName(g.by))}` : ''}</span>
          <button type="button" class="icon-btn icon-btn--small" data-action="admin-remove-game" data-date="${d.key}" data-gk="${esc(voteKey(g))}" aria-label="Remove ${esc(g.name)} from this day">${icon('x', 2)}</button>
        </li>`).join('')}</ul>
    </div>`).join('')}</div>`;
}

function adminHall() {
  if (state.playsError) return '<p class="muted">The hall of fame can\'t be loaded right now.</p>';
  if (!state.playsReady) return '<p class="loading">Loading…</p>';
  const plays = newestFirst(state.plays);
  const shown = state.adminAllPlays ? plays : plays.slice(0, ADMIN_PLAYS_SHOWN);
  return `
    <div class="adm-tools">
      <button type="button" class="btn btn--solid" data-action="play-add">${icon('plus', 2)} Add an entry</button>
      <span class="muted">Fix a mistake, or add a game night nobody logged.</span>
    </div>
    ${plays.length ? `<ul class="adm-list">${shown.map((p) => `
      <li class="adm-row">
        <div class="adm-main">
          <strong>${esc(p.game?.name ?? 'Unknown game')}</strong>
          <span class="adm-sub">${esc(dateLabel(p.date))} · ${p.winner ? `${esc(playerName(p.winner))} won` : 'no winner'} · ${plural(p.players.length, 'player')}${p.note ? ` · “${esc(p.note)}”` : ''}</span>
          ${p.campaign ? campaignTag(p) : ''}
        </div>
        <div class="adm-actions">
          <button type="button" class="btn btn--small" data-action="play-edit" data-id="${esc(p.id)}">Edit</button>
          <button type="button" class="btn btn--small" data-action="delete-play" data-id="${esc(p.id)}">${icon('x', 2)} Remove</button>
        </div>
      </li>`).join('')}</ul>` : '<p class="muted">Nothing logged yet.</p>'}
    ${plays.length > ADMIN_PLAYS_SHOWN ? `<button type="button" class="btn btn--small" data-action="admin-plays-toggle">${state.adminAllPlays ? 'Show fewer' : `Show all ${plays.length}`}</button>` : ''}`;
}

function adminBackup() {
  return `
    <p>One file with everything the site stores: the players (and their collections), every day, the hall of fame and the campaigns. Admin accounts aren't in it.</p>
    <div class="adm-tools">
      <button type="button" class="btn btn--solid" data-action="admin-backup"${state.backupBusy ? ' disabled' : ''}>${icon('download', 2)} ${state.backupBusy ? 'Preparing…' : 'Download backup'}</button>
    </div>
    ${state.backupNote ? `<p class="adm-status" role="status">${esc(state.backupNote)}</p>` : ''}
    <p class="muted">There's no restore button: the file is a safety copy to keep somewhere safe. If something is ever lost, everything needed to put it back is in there.</p>`;
}

function renderAdmin() {
  const body = $('#admin-body');
  if (!adminOn) { body.innerHTML = ''; return; }
  if (state.view !== 'admin') return;       // nothing to draw while another page is showing
  const players = Object.keys(state.players).length;
  $('#admin-count').textContent = `${plural(players, 'player')} · ${plural(state.campaigns.length, 'campaign')} · ${plural(state.plays.length, 'logged game')}`;
  body.innerHTML = `
    <p class="admin-intro muted">Only admins can see this page. New admins are still added by hand in the Firebase console (see the README).</p>
    ${fold('adm-players', 'Players', { count: players, body: adminPlayers() })}
    ${fold('adm-upcoming', 'Campaigns and upcoming games', {
    count: state.campaigns.length,
    body: `<h3 class="h-small adm-head">All campaigns <span class="count">${state.campaigns.length}</span></h3>${adminCampaigns()}
      <h3 class="h-small adm-head">Games suggested for the next two weeks</h3>${adminUpcomingGames()}`,
  })}
    ${fold('adm-hall', 'Hall of fame', { count: state.plays.length, open: false, body: adminHall() })}
    ${fold('adm-backup', 'Backup', { body: adminBackup() })}`;
}

// A game somebody suggested for a coming day, taken off that day's list (with its votes).
function adminRemoveGame(el) {
  const key = el.dataset.date;
  const game = (state.days[key]?.games ?? []).find((g) => voteKey(g) === el.dataset.gk);
  if (!adminOn || !game) return;
  askConfirm({
    title: `Remove ${game.name}?`,
    message: `It comes off ${dateLabel(key)}'s list, along with its votes.`,
    label: 'Remove',
    failMessage: "Couldn't remove the game. Please try again.",
  }, async () => {
    await state.store.removeGame(key, game);
    toast('Game removed');
  });
}

async function downloadBackup() {
  if (!adminOn || state.backupBusy) return;
  state.backupBusy = true;
  renderAdmin();
  try {
    const now = new Date();
    const backup = buildBackup(await state.store.exportAll(), now);
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' }));
    link.download = backupName(now);
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 5000);
    const c = backup.counts;
    state.backupNote = `Saved ${link.download}: ${plural(c.players, 'player')}, ${plural(c.days, 'day')}, ${plural(c.plays, 'logged game')}, ${plural(c.campaigns, 'campaign')}.`;
  } catch (err) {
    fail(err, "Couldn't make the backup. Please try again.");
  } finally {
    state.backupBusy = false;
    renderAdmin();
  }
}

// --- edit (or add) a hall-of-fame entry ---

const phName = (id) => state.players[id]?.name ?? state.edit?.names?.[id] ?? 'Former player';

// Everyone who can be ticked: the players, plus anyone on this entry who has since left it.
const phPeople = () => [...sortedPlayers().map((p) => p.id), ...Object.keys(state.edit.names).filter((id) => !state.players[id])];

function openPlayEditor(id = null) {
  if (!adminOn) return;
  const play = id ? state.plays.find((p) => p.id === id) : null;
  if (id && !play) return;
  const today = state.daysList[0].key;
  state.edit = {
    id,
    game: play ? { id: play.game.id ?? null, name: play.game.name, year: play.game.year || 0 } : null,
    players: new Set(play?.players ?? []),
    winner: play ? (play.winner ?? null) : undefined,       // undefined: not chosen yet, null: nobody won
    names: { ...(play?.names ?? {}) },                      // the names it remembers, for people who have left
  };
  const gone = play?.campaign && !state.campaigns.some((c) => c.id === play.campaign);
  openSheet(id ? 'Edit entry' : 'Add an entry', `
    <form id="ph-form" class="adm-form" autocomplete="off">
      <label class="field"><span>Date</span>
        <input id="ph-date" type="date" required max="${esc(today)}" value="${esc(play?.date ?? today)}">
      </label>
      <fieldset class="field"><legend>Game</legend>
        <p id="ph-picked" class="log-picked"></p>
        <label class="sr-only" for="ph-q">Search for a game</label>
        <input id="ph-q" type="search" placeholder="Search, or type a name" spellcheck="false">
        <ul id="ph-results" class="results"></ul>
      </fieldset>
      <fieldset class="field"><legend>Who played?</legend><div id="ph-players" class="choices"></div></fieldset>
      <fieldset class="field"><legend>Who won?</legend><div id="ph-winner" class="choices"></div></fieldset>
      <label class="field"><span>Campaign</span>
        <select id="ph-campaign">
          <option value="">Not part of a campaign</option>
          ${gone ? `<option value="${esc(play.campaign)}" selected>A campaign that has been removed</option>` : ''}
          ${state.campaigns.map((c) => `<option value="${esc(c.id)}"${play?.campaign === c.id ? ' selected' : ''}>${esc(c.title)}</option>`).join('')}
        </select>
      </label>
      <label class="field"><span>Note (optional)</span>
        <input id="ph-note" maxlength="140" value="${esc(play?.note ?? '')}">
      </label>
      <p id="ph-error" class="error" role="alert" hidden></p>
      <div class="row">
        <button type="button" class="btn" data-action="close-dialog">Cancel</button>
        <button type="submit" class="btn btn--solid">${id ? 'Save changes' : 'Add entry'}</button>
      </div>
    </form>`);
  renderPhGame();
  renderPhPlayers();
  renderPhWinner();
  if (!isLoaded()) loadGames().then(renderPhResults).catch(() => {});
}

function renderPhGame() {
  const { game } = state.edit;
  $('#ph-picked').innerHTML = game
    ? `Playing: <strong>${esc(game.name)}</strong>${game.year ? ` <span class="muted">${game.year}</span>` : ''}`
    : '<span class="muted">Search for the game, then choose it from the list.</span>';
}

function renderPhPlayers() {
  const { players } = state.edit;
  rerender($('#ph-players'), phPeople().map((id) => choice(
    `data-action="ph-player" data-id="${esc(id)}"${state.players[id] ? ` style="--h:${hueOf(state.players[id].avatar)}"` : ''}`,
    players.has(id),
    `${state.players[id] ? avatar(state.players[id].avatar, 24) : ''}<span>${esc(phName(id))}</span>`,
    'choice--player',
  )).join(''));
}

function renderPhWinner() {
  const { players, winner } = state.edit;
  rerender($('#ph-winner'), phPeople().filter((id) => players.has(id)).map((id) => choice(
    `data-action="ph-winner" data-id="${esc(id)}"${state.players[id] ? ` style="--h:${hueOf(state.players[id].avatar)}"` : ''}`,
    winner === id,
    `${state.players[id] ? avatar(state.players[id].avatar, 24) : ''}<span>${esc(phName(id))}</span>`,
    'choice--player',
  )).join('') + choice('data-action="ph-winner" data-id=""', winner === null, '<span>Nobody (co-op or draw)</span>'));
}

function renderPhResults() {
  const input = $('#ph-q');
  if (!input) return;
  const raw = input.value.trim();
  const row = (g, hint = '') => `<li><button type="button" class="result" data-action="ph-pick-game" data-id="${g.id ?? ''}" data-name="${esc(g.name)}" data-year="${g.year || ''}">
    <span class="result-name">${esc(g.name)}</span><span class="result-meta">${esc(hint || g.year || '')}</span>${icon('check', 2)}</button></li>`;
  const out = [];
  if (raw.length >= 2) {
    if (isLoaded()) searchGames(raw, 6).forEach((g) => out.push(row(g)));
    else out.push('<li class="muted">Loading the game list…</li>');
    out.push(row({ id: null, name: raw, year: 0 }, 'use as typed'));
  }
  $('#ph-results').innerHTML = out.join('');
}

async function submitPlayEdit(form) {
  const E = state.edit;
  const error = $('#ph-error');
  const { play, error: problem } = buildPlay({
    date: $('#ph-date').value,
    game: E.game,
    players: E.players,
    winner: E.winner,
    campaign: $('#ph-campaign').value,
    note: $('#ph-note').value,
  }, { today: state.daysList[0].key, nameOf: phName });
  if (problem) {
    error.textContent = problem;
    error.hidden = false;
    return;
  }
  const submit = form.querySelector('[type="submit"]');
  submit.disabled = true;
  try {
    if (E.id) await state.store.updatePlay(E.id, play);       // a cleared note or campaign is removed
    else await state.store.logPlay({ ...withoutUndefined(play), loggedBy: state.me ?? 'admin' });
    $('#form-dialog').close();
    toast(E.id ? 'Entry saved' : 'Entry added');
  } catch (err) {
    submit.disabled = false;
    fail(err, "Couldn't save the entry. If this keeps happening, the site owner may need to publish the updated database rules from the README.");
  }
}

// ---------------------------------------------------------------------------
// install as an app
// ---------------------------------------------------------------------------

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();          // keep the browser's own banner away; we offer it from the footer
  state.installPrompt = e;
});
window.addEventListener('appinstalled', () => {
  state.installPrompt = null;
  renderFooter();
  toast('Installed!');
});

async function installApp() {
  const offered = state.installPrompt;
  if (offered) {
    state.installPrompt = null;
    offered.prompt();
    await offered.userChoice.catch(() => {});
    return;
  }
  openInfo('Install as an app', `
    <p>Add Board Game Night to your home screen and it opens like an app, full screen.</p>
    <ul class="tips">
      <li><strong>iPhone or iPad</strong> (in Safari): tap the Share button, then <em>Add to Home Screen</em>.</li>
      <li><strong>Android</strong> (in Chrome): open the menu (the three dots), then <em>Install app</em> or <em>Add to Home screen</em>.</li>
      <li><strong>Computer</strong> (Chrome or Edge): click the install icon at the right end of the address bar.</li>
    </ul>`);
}

// A small "?" popup, so explanations don't have to sit on the page all the time.
function openInfo(title, html) {
  $('#info-dialog').innerHTML = `
    <div class="sheet-head">
      <h2>${esc(title)}</h2>
      <button type="button" class="icon-btn" data-action="close-dialog" aria-label="Close">${icon('x', 2)}</button>
    </div>
    <div class="sheet-body">
      ${html}
      <div class="row"><button type="button" class="btn btn--solid" data-action="close-dialog">Got it</button></div>
    </div>`;
  $('#info-dialog').showModal();
}

function explainGameNight() {
  const here = savedIds(state.openKey).length;
  openInfo('How game nights work', `
    <p><strong>A game night</strong> happens once <strong>${plural(MIN_PLAYERS, 'player')}</strong> are available on a day. This day: ${here} of ${MIN_PLAYERS}.</p>
    <p><strong>Game ideas</strong> can be added from <strong>${plural(MIN_PLAYERS_FOR_IDEAS, 'available player')}</strong>, so you can float one early and others can join if they like it.</p>
    <p>Only players who are <strong>available</strong> on the day can vote, so the votes come from the people who would actually play.</p>`);
}

// ---------------------------------------------------------------------------
// who are you? (pick a name, join, edit profile)
// ---------------------------------------------------------------------------

// Hues already taken by other players' faces, so new faces get a clearly different tint.
const takenHues = (exceptId) => Object.values(state.players)
  .filter((p) => p.id !== exceptId)
  .map((p) => hueOf(p.avatar));

function setMe(id) {
  state.me = id;
  ls.set(state.meKey, id);
  renderAll();
}

function openWho(mode) {
  const list = sortedPlayers();
  if (mode === 'choose' && !list.length) mode = 'create';
  const keep = mode === 'edit' ? [Number(state.players[state.me]?.avatar) >>> 0] : [];
  const taken = takenHues(mode === 'edit' ? state.me : null);
  state.who = {
    mode,
    cands: [...keep, ...Array.from({ length: 8 - keep.length }, () => randomSeed(taken))],
    sel: 0,
  };
  renderWho();
  const dlg = $('#who-dialog');
  if (!dlg.open) dlg.showModal();
}

function renderWho() {
  const { mode } = state.who;
  const list = sortedPlayers();
  const close = `<button type="button" class="icon-btn" data-action="close-dialog" aria-label="Close">${icon('x', 2)}</button>`;
  if (mode === 'choose') {
    $('#who-dialog').innerHTML = `
      <div class="sheet-head"><h2>Who are you?</h2>${close}</div>
      <div class="sheet-body">
        <button type="button" class="btn btn--solid btn--wide" data-action="new-player">${icon('plus', 2)} I'm new here</button>
        <section class="block">
          <h3 class="h-small">Already in the group?</h3>
          <p class="muted">Tap your own name. Don't tap someone else's: that lets you change their days and profile.</p>
          <ul class="pick-list">${list.map((p) => `
            <li><button type="button" class="person-btn${p.id === state.me ? ' is-me' : ''}" style="--h:${hueOf(p.avatar)}" data-action="pick-player" data-id="${esc(p.id)}">${avatar(p.avatar, 36)}<span>${esc(p.name)}</span></button></li>`).join('')}</ul>
        </section>
      </div>`;
    return;
  }
  const editing = mode === 'edit';
  const title = editing ? 'Your profile' : list.length ? 'Join the group' : "You're first!";
  $('#who-dialog').innerHTML = `
    <div class="sheet-head"><h2>${title}</h2>${close}</div>
    <form id="who-form" class="sheet-body" autocomplete="off">
      ${editing ? `<p class="muted">You're editing <strong>${esc(state.players[state.me].name)}</strong>'s profile for everyone. If that isn't you, tap <em>Switch player</em> and then <em>I'm new here</em> instead of renaming it.</p>` : ''}
      <label class="field"><span>Your name</span>
        <input name="name" maxlength="20" required placeholder="Type your name" value="${esc(editing ? state.players[state.me].name : '')}">
      </label>
      <fieldset class="field"><legend>Pick your pixel face</legend>
        <div id="who-cands" class="cands"></div>
        <button type="button" class="btn" data-action="reroll">${icon('dice', 2)} More faces</button>
      </fieldset>
      ${editing ? `
      <section class="block">
        <h3 class="h-small">My collection <span id="who-games-count" class="count">${myGames().length}</span></h3>
        <p class="muted">The games you own or love, with a star for your favourites. Pick from them when you add a game to a day.</p>
        <button type="button" class="btn" data-action="my-games">${icon('box', 2)} Manage my collection</button>
      </section>` : ''}
      <p id="who-error" class="error" role="alert" hidden></p>
      <div class="row">
        ${editing ? '<button type="button" class="btn" data-action="switch">Switch player</button>'
    : list.length ? '<button type="button" class="btn" data-action="back">Back</button>' : ''}
        <button type="submit" class="btn btn--solid">${editing ? 'Save' : 'Join'}</button>
      </div>
    </form>`;
  renderCands();
  $('#who-form input').focus();
}

function renderCands() {
  const { cands, sel } = state.who;
  $('#who-cands').innerHTML = cands.map((seed, i) => `
    <button type="button" class="cand${i === sel ? ' is-sel' : ''}" data-action="cand" data-i="${i}" aria-pressed="${i === sel}" aria-label="Face ${i + 1}">${avatar(seed, 48)}</button>`).join('');
}

function rerollFaces() {
  const keep = state.who.mode === 'edit' ? [state.who.cands[0]] : [];
  const taken = takenHues(state.who.mode === 'edit' ? state.me : null);
  state.who.cands = [...keep, ...Array.from({ length: 8 - keep.length }, () => randomSeed(taken))];
  state.who.sel = 0;
  renderCands();
}

async function submitWho(form) {
  const editing = state.who.mode === 'edit';
  const name = form.elements.name.value.trim().replace(/\s+/g, ' ');
  const error = $('#who-error');
  const complain = (msg) => { error.textContent = msg; error.hidden = false; };
  if (!name) return complain('Please type your name.');
  const taken = Object.values(state.players).some(
    (p) => p.name.toLowerCase() === name.toLowerCase() && !(editing && p.id === state.me),
  );
  if (taken) return complain('Someone already goes by that name. Pick yourself from the list instead.');

  const face = state.who.cands[state.who.sel];
  const submit = form.querySelector('[type="submit"]');
  submit.disabled = true;
  try {
    if (editing) {
      await state.store.updatePlayer(state.me, { name, avatar: face });
    } else {
      setMe(await state.store.addPlayer({ name, avatar: face }));
    }
    $('#who-dialog').close();
    toast(editing ? 'Profile saved' : `Welcome, ${name}!`);
  } catch (err) {
    submit.disabled = false;
    fail(err, "Couldn't save your profile. Please try again.");
  }
}

// Picking an existing name makes this device that person: it can then change their days
// and profile. There are no passwords, so the only safeguard is asking first.
function claimPlayer(id) {
  const player = state.players[id];
  if (!player) return;
  if (id === state.me) {
    $('#who-dialog').close();
    return;
  }
  askConfirm({
    title: `Are you ${player.name}?`,
    message: `Only say yes if ${player.name} is you. This device will be able to change ${player.name}'s days and profile for everyone. If you're someone new, go back and tap "I'm new here".`,
    label: `Yes, I'm ${player.name}`,
  }, async () => {
    setMe(id);
    $('#who-dialog').close();
    toast(`Hi ${player.name}!`);
  });
}

// ---------------------------------------------------------------------------
// admin: sign in, and remove players
// ---------------------------------------------------------------------------

// `failMessage` is what's shown if it doesn't work; the default talks about the admin sign-in,
// since that's what most confirmations need.
function askConfirm({ title, message, label, failMessage }, onYes) {
  state.onConfirm = onYes;
  state.confirmFail = failMessage;
  $('#confirm-dialog').innerHTML = `
    <div class="sheet-head">
      <h2>${esc(title)}</h2>
      <button type="button" class="icon-btn" data-action="close-dialog" aria-label="Close">${icon('x', 2)}</button>
    </div>
    <div class="sheet-body">
      <p>${esc(message)}</p>
      <div class="row">
        <button type="button" class="btn" data-action="close-dialog">Cancel</button>
        <button type="button" class="btn btn--solid" data-action="confirm-yes">${esc(label)}</button>
      </div>
    </div>`;
  $('#confirm-dialog').showModal();
}

async function confirmYes(el) {
  el.disabled = true;
  el.textContent = 'Working…';
  try {
    await state.onConfirm();
    $('#confirm-dialog').close();
  } catch (err) {
    el.disabled = false;
    el.textContent = 'Try again';
    fail(err, state.confirmFail ?? "That didn't work. Are you still signed in as admin?");
  }
}

function deletePlayer(id) {
  const player = state.players[id];
  if (!player || !state.admin.isAdmin) return;
  askConfirm({
    title: `Remove ${player.name}?`,
    message: `${player.name} will be removed from the group and taken off every day they picked. This can't be undone.`,
    label: 'Remove',
  }, async () => {
    await state.store.deletePlayer(id);
    if (state.adminSelected === id) state.adminSelected = null;
    toast(`Removed ${player.name}`);
  });
}

const SIGN_IN_PROBLEMS = {
  'auth/popup-blocked': 'Your browser blocked the sign-in pop-up. Allow pop-ups for this site and try again.',
  'auth/unauthorized-domain': "This site's address isn't authorised for sign-in yet. In the Firebase console open Authentication → Settings → Authorized domains and add it.",
  'auth/operation-not-allowed': 'Google sign-in is not switched on yet. In the Firebase console open Authentication → Sign-in method, choose Google and enable it.',
};
const SIGN_IN_CANCELLED = ['auth/popup-closed-by-user', 'auth/cancelled-popup-request'];

function openAdminDialog({ problem } = {}) {
  const body = problem
    ? `<p class="error" role="alert">${esc(problem)}</p>`
    : `<p>You're signed in, but this account isn't an admin yet. To make it one, add its ID to the database:</p>
       <code class="uid">${esc(state.admin.uid)}</code>
       <button type="button" class="btn" data-action="copy-uid">Copy ID</button>
       <ol class="steps">
         <li>Firebase console → <strong>Firestore Database → Data</strong>.</li>
         <li><strong>Start collection</strong> named <code>admins</code> (if it already exists, open it and add a document).</li>
         <li>Set the <strong>Document ID</strong> to the ID above, add any field (for example <code>note</code> = <code>owner</code>), and save.</li>
       </ol>
       <p class="muted">This page switches to admin mode by itself once the document exists.</p>`;
  $('#admin-dialog').innerHTML = `
    <div class="sheet-head">
      <h2>${problem ? "Couldn't sign in" : 'Almost there'}</h2>
      <button type="button" class="icon-btn" data-action="close-dialog" aria-label="Close">${icon('x', 2)}</button>
    </div>
    <div class="sheet-body">${body}</div>`;
  if (!$('#admin-dialog').open) $('#admin-dialog').showModal();
}

async function adminSignIn() {
  state.adminAsked = true;
  try {
    await state.store.signIn();
  } catch (err) {
    state.adminAsked = false;
    if (SIGN_IN_CANCELLED.includes(err.code)) return;
    console.error(err);
    openAdminDialog({ problem: SIGN_IN_PROBLEMS[err.code] ?? 'Sign-in failed. Please try again.' });
  }
}

async function copyUid() {
  try {
    await navigator.clipboard.writeText(state.admin.uid);
    toast('ID copied');
  } catch {
    toast('Select the ID and copy it by hand');
  }
}

function onAdmin(admin) {
  state.admin = admin;
  adminOn = !!admin.isAdmin;
  // The Admin page appears for an admin who opened it directly, and goes away if admin rights do.
  if (!adminOn && location.hash === '#admin' && !admin.checking) location.hash = '#calendar';
  state.view = viewFromHash();
  const dialog = $('#admin-dialog');
  if (state.adminAsked && admin.signedIn && !admin.checking) {
    state.adminAsked = false;
    if (admin.isAdmin) toast('Admin mode on');
    else openAdminDialog();
  } else if (admin.isAdmin && dialog.open) {
    dialog.close();      // the admins document was just created
    toast('Admin mode on');
  }
  renderAll();
}

// ---------------------------------------------------------------------------
// events
// ---------------------------------------------------------------------------

const actions = {
  theme: () => applyTheme(currentTheme() === 'dark' ? 'light' : 'dark', true),
  pick: startPick,
  'cancel-pick': () => { state.mode = 'view'; renderAll(); },
  'save-pick': savePick,
  day: (el) => (state.mode === 'pick' ? toggleDraft(el.dataset.date) : openDay(el.dataset.date)),
  'open-day': (el) => openDay(el.dataset.date),
  'game-night-info': explainGameNight,
  'toggle-me': toggleMe,
  'adder-open': openAdder,
  'adder-close': closeAdder,
  'my-games': openMyGames,
  'open-collection': openCollection,
  'coll-add': (el) => {
    $('#form-dialog').close();
    addGame({ id: Number(el.dataset.id) || null, name: el.dataset.name, year: Number(el.dataset.year) || 0 });
  },
  'fav-toggle': (el) => toggleFavourite(el.dataset.gk),
  'mg-add': (el) => addMyGame({ id: Number(el.dataset.id) || null, name: el.dataset.name, year: Number(el.dataset.year) || 0 }),
  'mg-remove': (el) => removeMyGame(el.dataset.gk),
  'add-game': (el) => addGame({
    id: Number(el.dataset.id) || null,
    name: el.dataset.name,
    year: Number(el.dataset.year) || 0,
  }),
  'remove-game': removeGame,
  vote,
  bring,
  'edit-details': openDetails,
  'add-to-calendar': addToCalendar,
  'log-game-night': () => openLog(state.openKey),
  'log-idea': (el) => {
    state.log.game = { ...state.log.ideas[Number(el.dataset.i)] };
    renderLogGame();
  },
  'log-pick-game': (el) => {
    state.log.game = { id: Number(el.dataset.id) || null, name: el.dataset.name, year: Number(el.dataset.year) || 0 };
    $('#log-q').value = '';
    renderLogResults();
    renderLogGame();
  },
  'log-player': (el) => {
    const { players } = state.log;
    const id = el.dataset.id;
    if (players.has(id)) {
      players.delete(id);
      if (state.log.winner === id) state.log.winner = undefined;   // the winner has to be one of the players
    } else {
      players.add(id);
    }
    renderLogPlayers();
    renderLogWinner();
  },
  'log-winner': (el) => {
    state.log.winner = el.dataset.id === '' ? null : el.dataset.id;   // '' is the "nobody won" choice
    renderLogWinner();
  },
  'delete-play': (el) => deletePlay(el.dataset.id),
  'toggle-fold': (el) => {
    const id = el.dataset.fold;
    state.folds[id] = !isOpen(id, el.dataset.default !== '0');
    ls.set(FOLDS_KEY, JSON.stringify(state.folds));
    renderLastWeek();
    renderPlayers();
    renderCampaigns();
    renderHall();
    renderAdmin();
    renderDayPanel();                                                                                   // the campaign boxes in a day's panel fold too
    document.querySelector(`[data-action="toggle-fold"][data-fold="${CSS.escape(id)}"]`)?.focus();   // keep keyboard focus on the button
  },
  'player-card': (el) => openPlayerCard(el.dataset.id),
  'log-session': (el) => openLog(el.dataset.date, { campaignId: el.dataset.campaign }),
  'log-campaign': (el) => {
    const L = state.log;
    const campaign = state.campaigns.find((c) => c.id === el.dataset.id);
    if (campaign) {
      applyCampaignToLog(campaign);
    } else {                                   // "No, a normal game night"
      L.campaignId = null;
      L.game = L.defaultGame;
      L.players = new Set(L.defaultPlayers);
      if (L.winner && !L.players.has(L.winner)) L.winner = undefined;
    }
    renderLogCampaign();
    renderLogGame();
    renderLogPlayers();
    renderLogWinner();
    renderLogNext();
  },
  'start-campaign': openStartCampaign,
  'camp-pick-game': (el) => {
    state.start.game = { id: Number(el.dataset.id) || null, name: el.dataset.name, year: Number(el.dataset.year) || 0 };
    $('#camp-q').value = '';
    renderCampResults();
    renderCampGame();
  },
  'camp-player': (el) => {
    const { players } = state.start;
    if (el.dataset.id === state.me) return;   // the one who starts it is always in
    if (players.has(el.dataset.id)) players.delete(el.dataset.id);
    else players.add(el.dataset.id);
    renderCampPlayers();
  },
  'campaign-log': (el) => openLog(state.daysList[0].key, { campaignId: el.dataset.id, dateEditable: true }),
  'campaign-plan': (el) => openPlan(el.dataset.id),
  'campaign-set-next': (el) => setNext(el.dataset.id, el.dataset.date),
  'campaign-finish': (el) => openFinish(el.dataset.id),
  'campaign-winner': (el) => {
    state.finish.winner = el.dataset.id === '' ? null : el.dataset.id;   // '' is the "nobody in particular" choice
    renderFinish();
  },
  'campaign-finish-confirm': confirmFinish,
  'campaign-reopen': (el) => openReopen(el.dataset.id),
  'campaign-reopen-confirm': (el) => confirmReopen(el.dataset.id),
  'open-campaign': (el) => showCampaign(el.dataset.id),
  'campaign-join': (el) => joinCampaign(el.dataset.id),
  'campaign-leave': (el) => leaveCampaign(el.dataset.id),
  'campaign-lock': (el) => toggleLock(el.dataset.id),
  'campaign-add': (el) => openAddPlayers(el.dataset.id),
  'campaign-add-pick': (el) => {
    const { picks } = state.addPeople;
    if (picks.has(el.dataset.id)) picks.delete(el.dataset.id);
    else picks.add(el.dataset.id);
    renderAddPlayers();
  },
  'campaign-add-confirm': confirmAddPlayers,
  'campaign-delete': (el) => deleteCampaign(el.dataset.id),
  install: installApp,
  'reload-page': () => location.reload(),
  profile: () => openWho('edit'),
  who: () => openWho('choose'),
  switch: () => openWho('choose'),
  back: () => openWho('choose'),
  'new-player': () => openWho('create'),
  'pick-player': (el) => claimPlayer(el.dataset.id),
  cand: (el) => { state.who.sel = Number(el.dataset.i); renderCands(); },
  reroll: rerollFaces,
  'close-dialog': (el) => el.closest('dialog').close(),
  'delete-player': (el) => deletePlayer(el.dataset.id),
  'admin-remove-game': adminRemoveGame,
  'admin-select': (el) => {
    state.adminSelected = state.adminSelected === el.dataset.id ? null : el.dataset.id;     // tap again to close
    renderAdmin();
    document.querySelector(`[data-action="admin-select"][data-id="${CSS.escape(el.dataset.id)}"]`)?.focus();
  },
  'admin-plays-toggle': () => { state.adminAllPlays = !state.adminAllPlays; renderAdmin(); },
  'admin-backup': downloadBackup,
  'play-add': () => openPlayEditor(null),
  'play-edit': (el) => openPlayEditor(el.dataset.id),
  'ph-pick-game': (el) => {
    state.edit.game = { id: Number(el.dataset.id) || null, name: el.dataset.name, year: Number(el.dataset.year) || 0 };
    $('#ph-q').value = '';
    renderPhResults();
    renderPhGame();
  },
  'ph-player': (el) => {
    const { players } = state.edit;
    if (players.has(el.dataset.id)) {
      players.delete(el.dataset.id);
      if (state.edit.winner === el.dataset.id) state.edit.winner = undefined;     // the winner has to have played
    } else players.add(el.dataset.id);
    renderPhPlayers();
    renderPhWinner();
  },
  'ph-winner': (el) => {
    state.edit.winner = el.dataset.id === '' ? null : el.dataset.id;
    renderPhWinner();
  },
  'confirm-yes': confirmYes,
  'admin-signin': adminSignIn,
  'admin-signout': () => state.store.signOut(),
  'admin-help': () => openAdminDialog(),
  'copy-uid': copyUid,
  'reset-demo': () => { state.store.reset(); ls.set(state.meKey, null); location.reload(); },
};

// A click that starts and ends on a dialog's backdrop closes it. (Tracking the
// pointer-down stops a text-selection drag that ends outside from closing it.)
let downOnBackdrop = false;
document.addEventListener('pointerdown', (e) => { downOnBackdrop = e.target instanceof HTMLDialogElement; });

document.addEventListener('click', (e) => {
  if (e.target instanceof HTMLDialogElement) {
    if (downOnBackdrop) e.target.close();
    return;
  }
  const el = e.target.closest('[data-action]');
  if (el && !el.disabled) actions[el.dataset.action]?.(el, e);
});

document.addEventListener('input', (e) => {
  if (e.target.id === 'game-q') renderResults();
  if (e.target.id === 'log-q') renderLogResults();
  if (e.target.id === 'camp-q') renderCampResults();
  if (e.target.id === 'mg-q') renderMyResults();
  if (e.target.id === 'coll-q') renderCollection();
  if (e.target.id === 'ph-q') renderPhResults();
});

document.addEventListener('change', (e) => {
  if (e.target.id === 'log-date' && state.log) {
    state.log.date = e.target.value;
    renderLogNext();
  }
  if (e.target.id === 'log-next' && state.log) state.log.next = e.target.value;
});

document.addEventListener('submit', (e) => {
  e.preventDefault();
  if (e.target.id === 'who-form') submitWho(e.target);
  if (e.target.id === 'dp-add-form') $('#game-results [data-action="add-game"]')?.click();
  if (e.target.id === 'details-form') submitDetails(e.target);
  if (e.target.id === 'log-form') submitLog(e.target);
  if (e.target.id === 'campaign-form') submitStartCampaign(e.target);
  if (e.target.id === 'ph-form') submitPlayEdit(e.target);
});

$('#day-dialog').addEventListener('close', () => { state.openKey = null; });

// Back from "My games" to a day's add-a-game panel: show the list as it is now.
$('#form-dialog').addEventListener('close', () => { if ($('#game-q')) renderResults(); });

// ---------------------------------------------------------------------------
// data
// ---------------------------------------------------------------------------

function onData({ players, days, synced }) {
  state.players = players;
  state.days = days;
  state.ready = true;
  if (state.me && !players[state.me] && synced) {
    // This device remembered a player who isn't in the database any more (for
    // example an admin removed them): forget them and ask who they are again.
    state.me = null;
    state.mode = 'view';
    state.askedWho = false;
    ls.set(state.meKey, null);
  }
  renderAll();
  if (!state.me && !state.askedWho) {
    state.askedWho = true;
    openWho('choose');
  }
}

function onError(err) {
  console.error(err);
  showBanner("Can't reach the shared database. Check your connection, then reload. (Site owner: check the Firestore rules in the README.)");
}

// Today and the next two weeks, plus the week before today (for the "Last week" preview).
function setDays() {
  state.daysList = upcomingDays(DAYS_AHEAD);
  state.pastDays = pastDays(DAYS_BEHIND);
  state.futureKeys = new Set(state.daysList.map((d) => d.key));
}

function subscribe() {
  setDays();
  state.unsubscribe?.();
  state.unsubscribe = state.store.subscribe(
    onData,
    { from: state.pastDays[0].key, to: state.daysList[state.daysList.length - 1].key },
    onError,
  );

  // The hall of fame has its own listener and its own error handling, so a problem there
  // (say, rules that haven't been updated yet) only affects that page, never the calendar.
  state.unsubscribePlays?.();
  state.unsubscribePlays = state.store.subscribePlays(
    (plays) => {
      state.plays = plays;
      state.playsReady = true;
      state.playsError = false;
      renderHall();
    },
    (err) => {
      console.error(err);
      state.playsError = true;
      renderHall();
    },
  );

  state.unsubscribeCampaigns?.();
  state.unsubscribeCampaigns = state.store.subscribeCampaigns(
    (campaigns) => {
      state.campaigns = campaigns;
      state.campaignsReady = true;
      state.campaignsError = false;
      renderAll();
    },
    (err) => {
      console.error(err);
      state.campaignsError = true;
      renderCampaigns();
    },
  );
}

// Makes the site installable, and lets the page itself open without a connection.
function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || !location.protocol.startsWith('http')) return;
  navigator.serviceWorker.register('sw.js').catch((err) => console.warn('Service worker not registered:', err));
}

// A page that stays open (the installed app often does) never notices a new version of the site
// by itself. Whenever it comes back to the front, and every half hour, ask the server whether
// app.js has changed since this page started, and offer a reload if it has.
let appVersion = null;
let versionCheckedAt = 0;

async function checkForNewVersion() {
  if (!location.protocol.startsWith('http')) return;
  versionCheckedAt = Date.now();
  let tag = null;
  try {
    const res = await fetch('js/app.js', { method: 'HEAD', cache: 'no-cache' });
    if (res.ok) tag = res.headers.get('etag') || res.headers.get('last-modified');
  } catch { /* offline: nothing to check */ }
  if (!tag) return;
  if (appVersion === null) appVersion = tag;     // the first answer is "the version this page started with"
  else if (tag !== appVersion) {
    $('#update').innerHTML = `<strong>A new version of the site is ready.</strong>
      <button type="button" class="btn btn--small" data-action="reload-page">Reload</button>`;
    $('#update').hidden = false;
  }
}

document.addEventListener('visibilitychange', () => {
  if (!document.hidden && Date.now() - versionCheckedAt > 2 * 60 * 1000) checkForNewVersion();
});
setInterval(() => { if (!document.hidden) checkForNewVersion(); }, 30 * 60 * 1000);

// If the tab stays open past midnight, slide the calendar forward.
document.addEventListener('visibilitychange', () => {
  if (document.hidden || !state.store) return;
  if (upcomingDays(1)[0].key !== state.daysList[0]?.key) {
    state.mode = 'view';
    if ($('#day-dialog').open) $('#day-dialog').close();
    subscribe();
  }
});

async function boot() {
  setDays();
  renderStatic();
  renderAll();
  registerServiceWorker();
  checkForNewVersion();
  try {
    state.store = await createStore();
  } catch (err) {
    console.error(err);
    showBanner("The app couldn't start. If you just set up Firebase, double-check js/config.js.");
    return;
  }
  // The demo and the real site remember "who am I" separately.
  state.meKey = state.store.mode === 'local' ? 'bgn.me.demo' : 'bgn.me';
  state.me = ls.get(state.meKey);
  if (state.store.mode === 'local') {
    const note = isForcedDemo
      ? 'Nothing here touches the shared database; it all stays in this browser.'
      : 'Nothing here is shared yet; it all stays in this browser. See the README to connect the shared database.';
    showBanner(`<strong>Demo mode.</strong> ${note}
      <button type="button" class="btn btn--small" data-action="reset-demo">Reset demo</button>
      ${isForcedDemo ? `<a class="btn btn--small" href="${esc(location.pathname)}">Back to the real site</a>` : ''}`);
  }
  state.store.subscribeAdmin(onAdmin);
  subscribe();
}

boot();
