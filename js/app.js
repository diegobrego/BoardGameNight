import { MIN_PLAYERS, DAYS_AHEAD } from './config.js';
import { createStore, isForcedDemo } from './store.js';
import { avatar, randomSeed } from './avatar.js';
import { icon, iconInner } from './icons.js';
import { upcomingDays, longLabel, rangeLabel } from './dates.js';
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
  // Let the phone's browser bar match the header.
  $('meta[name="theme-color"]').content = getComputedStyle(document.documentElement).getPropertyValue('--solid').trim();
}

darkQuery?.addEventListener?.('change', () => {
  if (!ls.get(THEME_KEY)) applyTheme(preferredTheme(), false);
});

const state = {
  store: null,
  ready: false,              // first data has arrived
  players: {},               // id -> { id, name, avatar }
  days: {},                  // YYYY-MM-DD -> { players: [id], games: [...] }
  meKey: 'bgn.me',           // localStorage key for "who am I" (the demo gets its own)
  me: null,                  // this device's player id
  admin: { canSignIn: false, signedIn: false, checking: false, isAdmin: false, uid: null },
  adminAsked: false,         // the visitor just pressed "Admin sign-in"
  onConfirm: null,           // what the confirm dialog's yes-button does
  daysList: [],              // the visible calendar days
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

// Who is saved as free on a day (ignores players that no longer exist).
const savedIds = (key) => (state.days[key]?.players ?? []).filter((id) => state.players[id]);
const savedMine = (key) => !!state.me && savedIds(key).includes(state.me);

// Who counts as free on a day, including my not-yet-saved picks while in pick mode.
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
  applyTheme(preferredTheme(), false);   // also catches a device change that landed after the inline script ran
  const favicon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" rx="5" fill="#6d28d9"/><g color="#fff" transform="translate(2.4 2.4) scale(.8)">${iconInner('meeple')}</g></svg>`;
  $('#favicon').href = `data:image/svg+xml,${encodeURIComponent(favicon)}`;
  $('#legend').innerHTML = `
    <li><span class="swatch swatch--mine"></span>You're free</li>
    <li><span class="swatch swatch--go"></span>${MIN_PLAYERS}+ free: game on</li>
    <li><span class="swatch swatch--weekend"></span>Weekend</li>`;
}

const isSharedAdmin = () => state.store?.mode === 'firebase' && state.admin.isAdmin;

function renderHeader() {
  const me = state.players[state.me];
  const adminTag = isSharedAdmin() ? '<span class="tag">Admin</span>' : '';
  $('#me-slot').innerHTML = adminTag + (me
    ? `<button type="button" class="chip" data-action="profile" aria-label="Your profile: ${esc(me.name)}">${avatar(me.avatar, 28)}<span class="chip-name">${esc(me.name)}</span></button>`
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
  bar.hidden = !picking;
  document.body.classList.toggle('has-savebar', picking);
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
  const label = `${longLabel(d.date)}: ${plural(ids.length, 'player')} free${go ? ', game on' : ''}${mine ? ', including you' : ''}`;
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
        <span class="day-count">${ids.length} free</span>
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
        <li class="crew-item${p.id === state.me ? ' is-me' : ''}">${avatar(p.avatar, 28)}<span>${esc(p.name)}${p.id === state.me ? ' <em>(you)</em>' : ''}</span>${
  admin ? `<button type="button" class="crew-del" data-action="delete-player" data-id="${esc(p.id)}" aria-label="Remove ${esc(p.name)}">${icon('x', 2)}</button>` : ''}</li>`).join('')}</ul>`
    : '<p class="muted">Nobody has joined yet. Be the first!</p>'}`;
}

function renderAll() {
  renderHeader();
  renderFooter();
  renderToolbar();
  renderCalendar();
  renderCrew();
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
// day panel (who's free + game options)
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
  const go = ids.length >= MIN_PLAYERS;
  const mine = savedMine(key);
  const games = state.days[key]?.games ?? [];

  $('#dp-title').innerHTML = `${esc(longLabel(day.date))}${go ? `<span class="day-flag">${icon('star', 2)}<span>Game on</span></span>` : ''}`;

  $('#dp-who').innerHTML = `
    <h3 class="h-small">Who's free <span class="count">${ids.length}</span></h3>
    ${ids.length
    ? `<ul class="people">${ids.map((id) => `<li>${avatar(state.players[id].avatar, 32)}<span>${esc(state.players[id].name)}${id === state.me ? ' <em>(you)</em>' : ''}</span></li>`).join('')}</ul>`
    : '<p class="muted">Nobody yet.</p>'}
    <button type="button" class="btn${mine ? '' : ' btn--solid'}" data-action="toggle-me">${mine ? "I can't make it" : "I'm free this day"}</button>`;

  $('#dp-games-head').innerHTML = `
    <h3 class="h-small">Game options <span class="count">${games.length}</span></h3>
    ${go ? '' : `<p class="lock">${icon('star', 2)} Unlocks when ${MIN_PLAYERS}+ players are free (${ids.length}/${MIN_PLAYERS}).</p>`}`;

  // Most votes first; games with the same number of votes keep the order they were added.
  // Votes from players who no longer exist are ignored.
  const votes = state.days[key]?.votes ?? {};
  const ranked = games
    .map((g, i) => ({ g, i, voters: (votes[voteKey(g)] ?? []).filter((id) => state.players[id]).sort(byName) }))
    .sort((a, b) => b.voters.length - a.voters.length || a.i - b.i);
  const topVotes = ranked[0]?.voters.length ?? 0;

  $('#dp-list').innerHTML = ranked.length
    ? ranked.map(({ g, voters }) => {
      const by = state.players[g.by];
      const k = voteKey(g);
      const voted = !!state.me && voters.includes(state.me);
      const top = ranked.length > 1 && topVotes > 0 && voters.length === topVotes;
      return `
        <li class="game${top ? ' is-top' : ''}">
          <button type="button" class="vote${voted ? ' is-on' : ''}" data-action="vote" data-gk="${esc(k)}" aria-pressed="${voted}"
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
            ${by ? `<span class="game-by">added by ${avatar(by.avatar, 18)} ${esc(by.name)}</span>` : ''}
          </div>
          ${g.by === state.me || state.admin.isAdmin ? `<button type="button" class="icon-btn" data-action="remove-game" data-gk="${esc(k)}" aria-label="Remove ${esc(g.name)}">${icon('x', 2)}</button>` : ''}
        </li>`;
    }).join('')
    : go ? '<li class="muted">No games yet. Add the first one!</li>' : '';

  $('#dp-add').hidden = !go;
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
  const gk = el.dataset.gk;
  const alreadyVoted = (state.days[key]?.votes?.[gk] ?? []).includes(state.me);
  try {
    await state.store.toggleVote(key, gk, state.me, !alreadyVoted);
  } catch (err) {
    fail(err, "Couldn't save your vote. Please try again.");
  }
}

// ---------------------------------------------------------------------------
// who are you? (pick a name, join, edit profile)
// ---------------------------------------------------------------------------

function setMe(id) {
  state.me = id;
  ls.set(state.meKey, id);
  renderAll();
}

function openWho(mode) {
  const list = sortedPlayers();
  if (mode === 'choose' && !list.length) mode = 'create';
  const keep = mode === 'edit' ? [Number(state.players[state.me]?.avatar) >>> 0] : [];
  state.who = {
    mode,
    cands: [...keep, ...Array.from({ length: 8 - keep.length }, randomSeed)],
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
            <li><button type="button" class="person-btn${p.id === state.me ? ' is-me' : ''}" data-action="pick-player" data-id="${esc(p.id)}">${avatar(p.avatar, 36)}<span>${esc(p.name)}</span></button></li>`).join('')}</ul>
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
  state.who.cands = [...keep, ...Array.from({ length: 8 - keep.length }, randomSeed)];
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
});

document.addEventListener('submit', (e) => {
  e.preventDefault();
  if (e.target.id === 'who-form') submitWho(e.target);
  if (e.target.id === 'dp-add-form') $('#game-results [data-action="add-game"]')?.click();
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
