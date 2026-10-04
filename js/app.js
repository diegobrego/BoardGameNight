import { MIN_PLAYERS, MIN_PLAYERS_FOR_IDEAS, DAYS_AHEAD, SITE_URL } from './config.js';
import { createStore, isForcedDemo } from './store.js';
import { avatar, randomSeed, hueOf } from './avatar.js';
import { icon, iconInner } from './icons.js';
import { upcomingDays, longLabel, rangeLabel } from './dates.js';
import { buildIcs } from './ics.js';
import { tally, ranked as rankList, newestFirst } from './hall.js';
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

// Which hall-of-fame lists the visitor has collapsed, remembered on this device.
const FOLD_KEY = 'bgn.hall.folded';
function loadFolded() {
  try { return new Set(JSON.parse(ls.get(FOLD_KEY) ?? '[]')); } catch { return new Set(); }
}

const state = {
  store: null,
  folded: loadFolded(),      // ids of collapsed hall-of-fame lists: 'wins' | 'nights' | 'plays'
  ready: false,              // first data has arrived
  players: {},               // id -> { id, name, avatar }
  days: {},                  // YYYY-MM-DD -> { players: [id], games: [...] }
  meKey: 'bgn.me',           // localStorage key for "who am I" (the demo gets its own)
  me: null,                  // this device's player id
  admin: { canSignIn: false, signedIn: false, checking: false, isAdmin: false, uid: null },
  adminAsked: false,         // the visitor just pressed "Admin sign-in"
  onConfirm: null,           // what the confirm dialog's yes-button does
  daysList: [],              // the visible calendar days
  view: location.hash === '#hall' ? 'hall' : 'calendar',   // which page: 'calendar' | 'hall'
  plays: [],                 // the hall of fame: one entry per game played
  playsReady: false,
  playsError: false,         // the hall of fame couldn't be loaded (e.g. rules not updated yet)
  installPrompt: null,       // the browser's "install this app" prompt, once it offers one
  log: null,                 // state of the "Log game night" popup
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
  if (state.mode === 'pick' && state.me) {
    const has = ids.includes(state.me);
    const wants = state.draft.has(key);
    if (wants && !has) ids = [...ids, state.me];
    if (!wants && has) ids = ids.filter((id) => id !== state.me);
  }
  return ids.sort(byName);
}

const changeCount = () => state.daysList.filter((d) => state.draft.has(d.key) !== savedMine(d.key)).length;

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
  $('#tab-hall').innerHTML = `${icon('trophy', 2)}<span>Hall of fame</span>`;
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
  const picking = state.mode === 'pick';
  const mine = !!state.me && ids.includes(state.me);
  const changed = picking && state.draft.has(d.key) !== savedMine(d.key);
  const cls = [
    'day', mine && 'is-mine', go && 'is-go', d.isWeekend && 'is-weekend',
    d.isToday && 'is-today', changed && 'is-changed', !ids.length && 'is-empty',
  ].filter(Boolean).join(' ');
  const label = `${longLabel(d.date)}: ${plural(ids.length, 'player')} available${go ? ', game on' : ''}${mine ? ', including you' : ''}`;
  const faces = ids.map((id) => avatar(state.players[id].avatar, 22, state.players[id].name)).join('');
  const sub = d.isToday ? 'Today' : d.num === 1 ? d.month : '';
  return `
    <button type="button" class="${cls}" data-action="day" data-date="${d.key}" aria-label="${esc(label)}"${picking ? ` aria-pressed="${mine}"` : ''}>
      <span class="day-date">
        <span class="day-dow">${d.dow}</span>
        <span class="day-num">${d.num}</span>
        <span class="day-sub">${sub}</span>
      </span>
      <span class="day-people">${faces}</span>
      <span class="day-status">
        <span class="day-count">${ids.length} available</span>
        ${go ? `<span class="day-flag">${icon('star', 2)}<span>Game on</span></span>` : ''}
        ${picking ? `<span class="day-check">${mine ? icon('check', 2) : ''}</span>` : ''}
      </span>
    </button>`;
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

function renderCrew() {
  const el = $('#crew');
  el.hidden = !state.ready;
  if (!state.ready) return;
  const list = sortedPlayers();
  const admin = state.admin.isAdmin;
  el.innerHTML = `
    <h2 class="h-small">The crew <span class="count">${list.length}</span></h2>
    ${admin && list.length ? '<p class="muted crew-hint">Admin: tap the X to remove someone from the crew and from all their days.</p>' : ''}
    ${list.length
    ? `<ul class="crew-list">${list.map((p) => `
        <li class="crew-item${p.id === state.me ? ' is-me' : ''}" style="--h:${hueOf(p.avatar)}">${avatar(p.avatar, 28)}<span>${esc(p.name)}${p.id === state.me ? ' <em>(you)</em>' : ''}</span>${
  admin ? `<button type="button" class="crew-del" data-action="delete-player" data-id="${esc(p.id)}" aria-label="Remove ${esc(p.name)}">${icon('x', 2)}</button>` : ''}</li>`).join('')}</ul>`
    : '<p class="muted">Nobody has joined yet. Be the first!</p>'}`;
}

// Admin only. It's a convenience rather than a lock (the link just fills in a WhatsApp
// message that anyone could write), so it keeps the buttons off everyone else's screen.
// For today and tomorrow it's a reminder; for later days it announces the game night.
function whatsappButton(day, extraClass = '') {
  const soon = day.isToday || day.key === state.daysList[1]?.key;
  const link = whatsappLink(whatsappText(soon ? 'remind' : 'announce', day));
  return `<a class="btn ${extraClass}" href="${esc(link)}" target="_blank" rel="noopener noreferrer" title="Opens WhatsApp with a ready-made message">${soon ? 'Remind the group' : 'Tell the group'} ${icon('arrow', 2)}</a>`;
}

// The orange banner: shown to everyone when today or tomorrow has enough players available.
function renderReminder() {
  const el = $('#reminder');
  const soon = state.ready && state.view === 'calendar'
    ? state.daysList.slice(0, 2).filter((d) => savedIds(d.key).length >= MIN_PLAYERS)
    : [];
  el.hidden = !soon.length;
  el.innerHTML = soon.map((d) => {
    const ids = savedIds(d.key).sort(byName);
    const pick = topPickLine(d.key);
    const where = detailsLine(d.key);
    return `
      <div class="reminder-item">
        <span class="reminder-icon">${icon('bell', 3)}</span>
        <p class="reminder-text">
          <strong>Game night ${d.isToday ? 'today' : 'tomorrow'}!</strong>
          ${esc(longLabel(d.date))}. ${esc(listNames(ids))} ${ids.length === 1 ? 'is' : 'are'} available${savedMine(d.key) ? " (you're in)" : ''}.${where ? ` Where: ${esc(where)}.` : ''}${pick ? ` ${esc(pick)}.` : ''}
        </p>
        <span class="reminder-actions">
          <button type="button" class="btn btn--small" data-action="open-day" data-date="${d.key}">See the day</button>
          ${state.admin.isAdmin ? whatsappButton(d, 'btn--small') : ''}
        </span>
      </div>`;
  }).join('');
}

// ---------------------------------------------------------------------------
// hall of fame
// ---------------------------------------------------------------------------

const nameFromPlays = (id) => state.plays.find((p) => p.names?.[id])?.names[id] ?? 'Former player';
const playerName = (id) => state.players[id]?.name ?? nameFromPlays(id);

// A player as a tinted pill. Someone who has since left the crew shows as plain text.
function playerPill(id) {
  const p = state.players[id];
  return p
    ? `<span class="pill" style="--h:${hueOf(p.avatar)}">${avatar(p.avatar, 24, p.name)}<span>${esc(p.name)}</span></span>`
    : `<span class="pill is-gone"><span>${esc(playerName(id))}</span><em>(left)</em></span>`;
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
      <div class="play-line"><span class="play-label">Winner</span>${p.winner ? playerPill(p.winner) : '<span class="muted">Nobody (co-op or draw)</span>'}</div>
      <div class="play-line"><span class="play-label">Played by</span><span class="play-faces">${faces}</span><span class="muted">${plural(p.players.length, 'player')}</span></div>
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
function fold(id, title, { count, preview = '', body }) {
  const open = !state.folded.has(id);
  return `
    <section class="fold${open ? '' : ' is-collapsed'}">
      <button type="button" class="fold-head" data-action="toggle-fold" data-fold="${id}" aria-expanded="${open}" aria-controls="fold-${id}">
        <span class="h-small">${esc(title)} <span class="count">${count}</span></span>
        ${icon('chevron', 2)}
      </button>
      ${open ? '' : preview}
      <div id="fold-${id}" class="fold-body"${open ? '' : ' hidden'}>${body}</div>
    </section>`;
}

// While a ranking is collapsed, just the leader: the first row, plus a note if others tie for first.
function leaderPreview(rows, unit) {
  const leaders = rows.filter((r) => r.rank === 1);
  if (!leaders.length) return '';
  return `<div class="fold-preview">${rankingList(leaders.slice(0, 1), unit)}${
    leaders.length > 1 ? `<p class="muted fold-note">+${leaders.length - 1} more tied for first</p>` : ''}</div>`;
}

// Which page is showing. The hall of fame has its own gold look, set by data-page.
function renderView() {
  const hall = state.view === 'hall';
  document.documentElement.dataset.page = hall ? 'hall' : 'calendar';
  $('#view-calendar').hidden = hall;
  $('#view-hall').hidden = !hall;
  for (const [id, active] of [['#tab-calendar', !hall], ['#tab-hall', hall]]) {
    if (active) $(id).setAttribute('aria-current', 'page');
    else $(id).removeAttribute('aria-current');
  }
  syncThemeColor();
}

window.addEventListener('hashchange', () => {
  state.view = location.hash === '#hall' ? 'hall' : 'calendar';
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
  renderCrew();
  renderHall();
  renderDayPanel();
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
      <section id="dp-details" class="block"></section>
      <section id="dp-games" class="block">
        <div id="dp-games-head"></div>
        <ul id="dp-list" class="games"></ul>
        <div id="dp-add">
          <button type="button" id="dp-add-open" class="btn btn--solid btn--wide" data-action="adder-open">${icon('plus', 2)} Add a game</button>
          <form id="dp-add-form" hidden autocomplete="off">
            <label class="sr-only" for="game-q">Search for a game</label>
            <input id="game-q" type="search" placeholder="Search BoardGameGeek, or paste a link" enterkeyhint="search" spellcheck="false">
            <ul id="game-results" class="results"></ul>
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
  const day = state.daysList.find((d) => d.key === key);
  if (!day) return;
  const ids = savedIds(key).sort(byName);
  const go = ids.length >= MIN_PLAYERS;                         // a real game night: green, "Game on"
  const canSuggest = ids.length >= MIN_PLAYERS_FOR_IDEAS;       // ideas can be added and voted on
  const mine = savedMine(key);
  const games = state.days[key]?.games ?? [];

  $('#dp-title').innerHTML = `${esc(longLabel(day.date))}${go ? `<span class="day-flag">${icon('star', 2)}<span>Game on</span></span>` : ''}`;

  $('#dp-who').innerHTML = `
    <h3 class="h-small">Who's available <span class="count">${ids.length}</span></h3>
    ${ids.length
    ? `<ul class="people">${ids.map((id) => `<li style="--h:${hueOf(state.players[id].avatar)}">${avatar(state.players[id].avatar, 32)}<span>${esc(state.players[id].name)}${id === state.me ? ' <em>(you)</em>' : ''}</span></li>`).join('')}</ul>`
    : '<p class="muted">Nobody yet.</p>'}
    <button type="button" class="btn${mine ? '' : ' btn--solid'}" data-action="toggle-me">${mine ? "I can't make it" : "I'm available this day"}</button>
    ${state.admin.isAdmin && go ? whatsappButton(day) : ''}`;

  // Where and when, adding it to a calendar, and (today only) logging what was played.
  const { place = '', time = '' } = state.days[key]?.details ?? {};
  const hasDetails = !!(place || time);
  const showDetails = go || hasDetails;
  const dayButtons = [
    go ? `<button type="button" class="btn" data-action="add-to-calendar">${icon('calendar', 2)} Add to calendar</button>` : '',
    day.isToday ? `<button type="button" class="btn btn--solid" data-action="log-game-night">${icon('trophy', 2)} Log game night</button>` : '',
  ].join('');
  $('#dp-details').hidden = !showDetails && !dayButtons;
  $('#dp-details').innerHTML = `
    ${showDetails ? `
      <div class="head-row">
        <h3 class="h-small">Game night</h3>
        ${mine ? `<button type="button" class="btn btn--small" data-action="edit-details">${hasDetails ? 'Edit' : 'Add location &amp; time'}</button>` : ''}
      </div>
      ${hasDetails
    ? `<ul class="details">${place ? `<li>${icon('pin', 2)}<span>${esc(place)}</span></li>` : ''}${time ? `<li>${icon('clock', 2)}<span>${esc(time)}</span></li>` : ''}</ul>`
    : '<p class="muted">No location yet.</p>'}` : ''}
    ${dayButtons ? `<div class="actions">${dayButtons}</div>` : ''}`;

  // The rules of the game ("how many players make a game night", who can vote) live behind
  // the ? button instead of taking up room here all the time.
  $('#dp-games-head').innerHTML = `
    <div class="head-row">
      <h3 class="h-small">Game options <span class="count">${games.length}</span></h3>
      <button type="button" class="icon-btn icon-btn--small" data-action="game-night-info" aria-label="How game nights work" title="How game nights work">${icon('help', 2)}</button>
    </div>
    ${canSuggest ? '' : '<p class="muted">Ideas open up once someone is available.</p>'}`;

  const { ranked, topVotes } = rankGames(key);

  $('#dp-list').innerHTML = ranked.length
    ? ranked.map(({ g, voters, bringers }) => {
      const by = state.players[g.by];
      const k = voteKey(g);
      const voted = !!state.me && voters.includes(state.me);
      const bringing = !!state.me && bringers.includes(state.me);
      const top = ranked.length > 1 && topVotes > 0 && voters.length === topVotes;
      return `
        <li class="game${top ? ' is-top' : ''}">
          <button type="button" class="vote${voted ? ' is-on' : ''}${mine ? '' : ' is-locked'}" data-action="vote" data-gk="${esc(k)}" aria-pressed="${voted}"${mine ? '' : ' aria-disabled="true" title="Only players who are available this day can vote"'}
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
              <button type="button" class="bring${bringing ? ' is-on' : ''}${mine ? '' : ' is-locked'}" data-action="bring" data-gk="${esc(k)}" aria-pressed="${bringing}"${mine ? '' : ' aria-disabled="true" title="Only players who are available this day can bring a game"'}>
                ${icon('box', 2)}<span>${bringing ? "I'm bringing it" : "I'll bring it"}</span>
              </button>
              ${bringers.length ? `<span class="game-brings">Brought by ${esc(listNames(bringers))}</span>` : ''}
            </div>
            ${by ? `<span class="game-by">added by ${avatar(by.avatar, 18)} ${esc(by.name)}</span>` : ''}
          </div>
          ${g.by === state.me || state.admin.isAdmin ? `<button type="button" class="icon-btn" data-action="remove-game" data-gk="${esc(k)}" aria-label="Remove ${esc(g.name)}">${icon('x', 2)}</button>` : ''}
        </li>`;
    }).join('')
    : canSuggest ? '<li class="muted">No games yet. Add the first one!</li>' : '';

  $('#dp-add').hidden = !canSuggest;
}

async function toggleMe() {
  if (!state.me) return openWho('choose');
  const key = state.openKey;
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

function renderResults() {
  const input = $('#game-q');
  if (!input) return;
  const raw = input.value.trim();
  const out = [];

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

// Tap once to vote for a game, tap again to take the vote back. Vote for as many as you like.
async function vote(el) {
  if (!state.me) return openWho('choose');
  const key = state.openKey;
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
  const day = state.daysList.find((d) => d.key === state.openKey);
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

function openLog(key) {
  if (!state.me) return openWho('choose');
  const day = state.daysList.find((d) => d.key === key);
  const { ranked: ideas, topVotes } = rankGames(key);
  const leaders = ideas.filter((r) => r.voters.length === topVotes);
  const asGame = (g) => ({ id: g.id ?? null, name: g.name, year: g.year || 0 });
  state.log = {
    date: key,
    ideas: ideas.map(({ g }) => asGame(g)),
    // if one game clearly won the vote, start with it selected
    game: topVotes > 0 && leaders.length === 1 ? asGame(leaders[0].g) : null,
    players: new Set(savedIds(key)),   // everyone who was available; adjust below
    winner: undefined,                 // undefined: not chosen yet, null: nobody won, otherwise a player id
  };
  $('#log-dialog').innerHTML = `
    <div class="sheet-head"><h2>Log game night</h2>${closeBtn()}</div>
    <form id="log-form" class="sheet-body" autocomplete="off">
      <p class="muted">${esc(longLabel(day.date))}. This is saved to the hall of fame for everyone.</p>
      <fieldset class="field"><legend>What did you play?</legend>
        <div id="log-ideas" class="choices"></div>
        <label class="sr-only" for="log-q">Something else</label>
        <input id="log-q" type="search" placeholder="Something else? Search, or type a name" spellcheck="false">
        <ul id="log-results" class="results"></ul>
        <p id="log-picked" class="log-picked"></p>
      </fieldset>
      <fieldset class="field"><legend>Who played?</legend><div id="log-players" class="choices"></div></fieldset>
      <fieldset class="field"><legend>Who won?</legend><div id="log-winner" class="choices"></div></fieldset>
      <p id="log-error" class="error" role="alert" hidden></p>
      <div class="row">
        <button type="button" class="btn" data-action="close-dialog">Cancel</button>
        <button type="submit" class="btn btn--solid">Log it</button>
      </div>
    </form>`;
  renderLogGame();
  renderLogPlayers();
  renderLogWinner();
  $('#log-dialog').showModal();
}

function renderLogGame() {
  const { ideas, game } = state.log;
  rerender($('#log-ideas'), ideas.length
    ? ideas.map((g, i) => choice(`data-action="log-idea" data-i="${i}"`, sameGame(game, g), `<span>${esc(g.name)}</span>${g.year ? `<em>${g.year}</em>` : ''}`)).join('')
    : '<p class="muted">Nobody suggested a game for this day, so search for what you played.</p>');
  $('#log-picked').innerHTML = game
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
  if (!L.game) return complain('Choose the game you played.');
  if (!L.players.size) return complain('Tick the players who took part.');
  if (L.winner === undefined) return complain('Choose who won, or "Nobody" for a co-op game or a draw.');

  const ids = sortedPlayers().filter((p) => L.players.has(p.id)).map((p) => p.id);
  const submit = form.querySelector('[type="submit"]');
  submit.disabled = true;
  try {
    await state.store.logPlay({
      date: L.date,
      game: { id: L.game.id ?? null, name: L.game.name, year: L.game.year || 0 },
      winner: L.winner,
      players: ids,
      names: Object.fromEntries(ids.map((id) => [id, state.players[id].name])),   // so history survives renames and removals
      loggedBy: state.me,
    });
    $('#log-dialog').close();
    if ($('#day-dialog').open) $('#day-dialog').close();
    toast('Game night logged!');
    location.hash = '#hall';
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
          <h3 class="h-small">Already in the crew?</h3>
          <p class="muted">Tap your own name. Don't tap someone else's: that lets you change their days and profile.</p>
          <ul class="pick-list">${list.map((p) => `
            <li><button type="button" class="person-btn${p.id === state.me ? ' is-me' : ''}" style="--h:${hueOf(p.avatar)}" data-action="pick-player" data-id="${esc(p.id)}">${avatar(p.avatar, 36)}<span>${esc(p.name)}</span></button></li>`).join('')}</ul>
        </section>
      </div>`;
    return;
  }
  const editing = mode === 'edit';
  const title = editing ? 'Your profile' : list.length ? 'Join the crew' : "You're first!";
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

function askConfirm({ title, message, label }, onYes) {
  state.onConfirm = onYes;
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
    fail(err, "That didn't work. Are you still signed in as admin?");
  }
}

function deletePlayer(id) {
  const player = state.players[id];
  if (!player || !state.admin.isAdmin) return;
  askConfirm({
    title: `Remove ${player.name}?`,
    message: `${player.name} will be removed from the crew and taken off every day they picked. This can't be undone.`,
    label: 'Remove',
  }, async () => {
    await state.store.deletePlayer(id);
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
    if (state.folded.has(id)) state.folded.delete(id);
    else state.folded.add(id);
    ls.set(FOLD_KEY, JSON.stringify([...state.folded]));
    renderHall();
    $(`[data-action="toggle-fold"][data-fold="${id}"]`)?.focus();   // keep keyboard focus on the button
  },
  install: installApp,
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
});

document.addEventListener('submit', (e) => {
  e.preventDefault();
  if (e.target.id === 'who-form') submitWho(e.target);
  if (e.target.id === 'dp-add-form') $('#game-results [data-action="add-game"]')?.click();
  if (e.target.id === 'details-form') submitDetails(e.target);
  if (e.target.id === 'log-form') submitLog(e.target);
});

$('#day-dialog').addEventListener('close', () => { state.openKey = null; });

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

function subscribe() {
  state.daysList = upcomingDays(DAYS_AHEAD);
  state.unsubscribe?.();
  state.unsubscribe = state.store.subscribe(
    onData,
    { from: state.daysList[0].key, to: state.daysList[state.daysList.length - 1].key },
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
}

// Makes the site installable, and lets the page itself open without a connection.
function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || !location.protocol.startsWith('http')) return;
  navigator.serviceWorker.register('sw.js').catch((err) => console.warn('Service worker not registered:', err));
}

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
  state.daysList = upcomingDays(DAYS_AHEAD);
  renderStatic();
  renderAll();
  registerServiceWorker();
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
