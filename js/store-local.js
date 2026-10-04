// DEMO backend: everything lives in this browser's localStorage. Handy for trying
// the site out; nothing is shared with anyone. Seeds a few fake players on first run.

import { randomSeed, hueOf } from './avatar.js';
import { upcomingDays, dateKey } from './dates.js';
import { voteKey } from './games.js';
import { sharedDoc } from './collection.js';

const KEY = 'bgn.demo.v3';

function seed() {
  const names = ['Mia', 'Leo', 'Zoe', 'Sam'];
  const players = {};
  const taken = [];   // pale tints already used, so the demo players look clearly different
  names.forEach((name, i) => {
    const avatar = randomSeed(taken);
    taken.push(hueOf(avatar));
    players[`demo${i}`] = { id: `demo${i}`, name, avatar };
  });
  // Mia already has a few favourites on her profile
  players.demo0.games = [
    { id: 13, name: 'Catan', year: 1995 },
    { id: 230802, name: 'Azul', year: 2017, fav: true },
    { id: 266192, name: 'Wingspan', year: 2019 },
    { id: 359871, name: 'Arcs', year: 2024, fav: true },
  ];
  const keys = upcomingDays(7).map((d) => d.key);
  const days = {
    // tomorrow: enough players, so the reminder banner shows
    [keys[1]]: {
      players: ['demo0', 'demo1', 'demo2'],
      games: [],
      details: { place: "Mia's place, Main Street 5", time: '19:30' },
    },
    // one short of a game night, but ideas are already welcome
    [keys[2]]: {
      players: ['demo1', 'demo2'],
      games: [{ id: 266192, name: 'Wingspan', year: 2019, by: 'demo1' }],
      votes: { g266192: ['demo2'] },
    },
    [keys[3]]: {
      players: ['demo0', 'demo1', 'demo2'],
      games: [
        { id: 13, name: 'Catan', year: 1995, by: 'demo0' },
        { id: 230802, name: 'Azul', year: 2017, by: 'demo1' },
      ],
      votes: { g13: ['demo0'], g230802: ['demo1', 'demo2'] },
      brings: { g13: ['demo0'] },
    },
    [keys[5]]: { players: ['demo1', 'demo2', 'demo3', 'demo0'], games: [] },
    [keys[6]]: { players: ['demo3'], games: [] },
  };

  // Days in the last week, so the "Last week" preview has something to show:
  // a game night that was never logged, and a quieter day.
  const daysAgo = (n) => {
    const t = new Date();
    return dateKey(new Date(t.getFullYear(), t.getMonth(), t.getDate() - n));
  };
  days[daysAgo(1)] = {
    players: ['demo0', 'demo1', 'demo2', 'demo3'],
    games: [{ id: 266192, name: 'Wingspan', year: 2019, by: 'demo1' }],
    votes: { g266192: ['demo0', 'demo2'] },
    details: { place: "Leo's flat", time: '20:00' },
  };
  days[daysAgo(4)] = { players: ['demo0', 'demo3'], games: [] };
  // older days, so "Tidy old days" on the Admin page has something to count
  for (const ago of [20, 45, 75, 120, 200, 400]) days[daysAgo(ago)] = { players: ['demo0', 'demo1'], games: [] };

  const namesOf = (ids) => Object.fromEntries(ids.map((id) => [id, players[id].name]));
  let n = 0;
  const play = (ago, game, winner, ids, extra = {}) => ({
    id: `seed${n++}`,
    date: daysAgo(ago),
    game,
    winner,
    players: ids,
    names: namesOf(ids),
    loggedBy: ids[0],
    createdAt: Date.now() - ago * 86400000 + n,
    ...extra,
  });
  const all = ['demo0', 'demo1', 'demo2', 'demo3'];
  const ARCS = { id: 359871, name: 'Arcs', year: 2024 };
  const OATH = { id: 291572, name: 'Oath', year: 2021 };

  // A few logged game nights, so the hall of fame has something to show...
  const plays = [
    play(21, { id: 13, name: 'Catan', year: 1995 }, 'demo0', all),
    play(14, { id: 230802, name: 'Azul', year: 2017 }, 'demo1', ['demo0', 'demo1', 'demo2']),
    play(14, { id: 266192, name: 'Wingspan', year: 2019 }, 'demo2', ['demo0', 'demo1', 'demo2']),
    play(7, { id: 30549, name: 'Pandemic', year: 2008 }, null, all),
    play(7, { id: 68448, name: '7 Wonders', year: 2010 }, 'demo0', ['demo0', 'demo1', 'demo3']),
    // ...and the sessions of two campaigns
    play(28, ARCS, 'demo1', ['demo0', 'demo1', 'demo2'], { campaign: 'c1', note: 'Chapter 1: the empire sets out' }),
    play(10, ARCS, 'demo0', ['demo0', 'demo1', 'demo2'], { campaign: 'c1', note: 'Chapter 2: Mia takes the lead' }),
    play(55, OATH, 'demo2', ['demo0', 'demo2', 'demo3'], { campaign: 'c2', note: 'The chronicle begins' }),
    play(36, OATH, 'demo2', ['demo0', 'demo2', 'demo3'], { campaign: 'c2', note: 'Zoe is Chancellor again' }),
  ];

  const campaign = (id, title, game, ids, extra) => ({
    id, title, game, players: ids, names: namesOf(ids), locked: false, createdBy: ids[0], createdAt: Date.now() - 5 * 86400000, ...extra,
  });
  const campaigns = [
    campaign('c1', 'Arcs: the long game', ARCS, ['demo0', 'demo1', 'demo2'], {
      status: 'active', startedAt: daysAgo(28), next: keys[5], finishedAt: '', winner: null,
    }),
    campaign('c2', 'Oath chronicle', OATH, ['demo0', 'demo2', 'demo3'], {
      status: 'finished', startedAt: daysAgo(55), next: '', finishedAt: daysAgo(36), winner: 'demo2',
    }),
    // started by Sam, and already locked: only Sam can add people now
    campaign('c3', 'Root: woodland war', { id: 237182, name: 'Root', year: 2018 }, ['demo3', 'demo1'], {
      status: 'active', startedAt: daysAgo(3), next: '', finishedAt: '', winner: null, locked: true,
    }),
  ];
  // a game that was played although nobody had it in a collection, and a few messages for the admin
  const sharedGames = [{ key: 'n_homebrew_quest', gameId: null, name: 'Homebrew Quest', year: 0, source: 'played', createdAt: Date.now() - 3 * 86400000 }];
  const feedback = [
    { id: 'fb1', message: 'Could the calendar show the time of each game night?', name: 'Zoe', by: 'demo2', createdAt: Date.now() - 2 * 86400000, seen: false },
    { id: 'fb2', message: 'Love the campaigns tab!', name: '', by: '', createdAt: Date.now() - 6 * 86400000, seen: true },
  ];
  campaigns[0].notes = 'Chapter 1: the empire sets out. Mia plays the red empire, Leo the blue one.\nHouse rule: reach cards are shuffled back in each chapter.';
  return { players, days, plays, campaigns, sharedGames, feedback };
}

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const saved = JSON.parse(raw);
      saved.plays ??= [];
      saved.campaigns ??= [];
      saved.sharedGames ??= [];
      saved.feedback ??= [];
      return saved;
    }
  } catch { /* fall through to a fresh seed */ }
  return seed();
}

export function create() {
  let state = load();
  const listeners = new Set();
  const playListeners = new Set();
  const campaignListeners = new Set();
  const sharedListeners = new Set();
  const feedbackListeners = new Set();
  const persist = () => { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* private mode */ } };
  const emit = () => listeners.forEach((fn) => fn({ players: state.players, days: state.days, synced: true }));
  const emitPlays = () => playListeners.forEach((fn) => fn([...state.plays]));
  const emitCampaigns = () => campaignListeners.forEach((fn) => fn([...state.campaigns]));
  const emitShared = () => sharedListeners.forEach((fn) => fn(state.sharedGames.map((g) => ({ ...g }))));
  const feedbackRows = () => state.feedback.map((f) => ({ ...f })).sort((a, b) => b.createdAt - a.createdAt);   // newest first, like the shared site
  const emitFeedback = () => feedbackListeners.forEach((fn) => fn(feedbackRows()));
  const toMs = (v) => (typeof v === 'string' ? Date.parse(v) || 0 : v ?? 0);   // backups from the shared site hold dates as text
  persist();

  // Keep several open tabs of the demo in step.
  window.addEventListener('storage', (e) => {
    if (e.key === KEY) { state = load(); emit(); emitPlays(); emitCampaigns(); emitShared(); emitFeedback(); }
  });

  const day = (date) => (state.days[date] ??= { players: [], games: [] });
  const same = (a, b) => (a.id ?? a.name) === (b.id ?? b.name) && a.by === b.by;
  const toggled = (list = [], playerId, on) => (
    on ? [...list.filter((id) => id !== playerId), playerId] : list.filter((id) => id !== playerId)
  );
  const newId = (prefix) => `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

  return {
    mode: 'local',

    subscribe(fn) {
      listeners.add(fn);
      queueMicrotask(() => fn({ players: state.players, days: state.days, synced: true }));
      return () => listeners.delete(fn);
    },

    async addPlayer({ name, avatar }) {
      const id = newId('p');
      state.players[id] = { id, name, avatar };
      persist(); emit();
      return id;
    },

    async updatePlayer(id, patch) {
      Object.assign(state.players[id], patch);
      persist(); emit();
    },

    async setPlayerGames(id, games) {
      state.players[id].games = games;
      persist(); emit();
    },

    async setAvailability(playerId, add, remove) {
      for (const k of add) {
        const d = day(k);
        if (!d.players.includes(playerId)) d.players.push(playerId);
      }
      for (const k of remove) {
        const d = day(k);
        d.players = d.players.filter((id) => id !== playerId);
      }
      persist(); emit();
    },

    async addGame(date, game) {
      day(date).games.push(game);
      persist(); emit();
    },

    // Removing a game takes its votes and its "I'll bring it"s with it.
    async removeGame(date, game) {
      const d = day(date);
      d.games = d.games.filter((g) => !same(g, game));
      if (d.votes) delete d.votes[voteKey(game)];
      if (d.brings) delete d.brings[voteKey(game)];
      persist(); emit();
    },

    // One vote per player per game; a player can vote for as many games as they like.
    async toggleVote(date, key, playerId, on) {
      const votes = (day(date).votes ??= {});
      votes[key] = toggled(votes[key], playerId, on);
      persist(); emit();
    },

    async toggleBring(date, key, playerId, on) {
      const brings = (day(date).brings ??= {});
      brings[key] = toggled(brings[key], playerId, on);
      persist(); emit();
    },

    async setDetails(date, { place, time }) {
      day(date).details = { place: place ?? '', time: time ?? '' };
      persist(); emit();
    },

    async deletePlayer(id) {
      delete state.players[id];
      for (const d of Object.values(state.days)) {
        d.players = d.players.filter((p) => p !== id);
        for (const map of [d.votes, d.brings]) {
          for (const [k, list] of Object.entries(map ?? {})) map[k] = list.filter((p) => p !== id);
        }
      }
      persist(); emit();
    },

    // The hall of fame: one entry per game played on a game night.
    subscribePlays(fn) {
      playListeners.add(fn);
      queueMicrotask(() => fn([...state.plays]));
      return () => playListeners.delete(fn);
    },

    async logPlay(play) {
      const id = newId('play');
      state.plays.push({ ...play, id, createdAt: Date.now() });
      persist(); emitPlays();
      return id;
    },

    async updatePlay(id, patch) {
      const play = state.plays.find((p) => p.id === id);
      for (const [key, value] of Object.entries(patch)) {
        if (value === undefined) delete play[key];
        else play[key] = value;
      }
      persist(); emitPlays();
    },

    async deletePlay(id) {
      state.plays = state.plays.filter((p) => p.id !== id);
      persist(); emitPlays();
    },

    // Everything, for the admin's backup download.
    async exportAll() {
      return JSON.parse(JSON.stringify({
        players: state.players,
        days: state.days,
        plays: state.plays,
        campaigns: state.campaigns,
        sharedGames: state.sharedGames.map(({ key, ...rest }) => ({ id: key, ...rest })),
      }));
    },

    // Campaigns: long games played over several sessions.
    subscribeCampaigns(fn) {
      campaignListeners.add(fn);
      queueMicrotask(() => fn([...state.campaigns]));
      return () => campaignListeners.delete(fn);
    },

    async createCampaign(campaign) {
      const id = newId('camp');
      state.campaigns.push({ ...campaign, id, createdAt: Date.now() });
      persist(); emitCampaigns();
      return id;
    },

    async updateCampaign(id, patch) {
      Object.assign(state.campaigns.find((c) => c.id === id), patch);
      persist(); emitCampaigns();
    },

    // The group's collection also holds games that were played though nobody had them listed.
    subscribeSharedGames(fn) {
      sharedListeners.add(fn);
      queueMicrotask(() => fn(state.sharedGames.map((g) => ({ ...g }))));
      return () => sharedListeners.delete(fn);
    },

    async addSharedGame(game) {
      const key = voteKey(game);
      if (state.sharedGames.some((g) => g.key === key)) return;
      state.sharedGames.push({ key, ...sharedDoc(game), createdAt: Date.now() });
      persist(); emitShared();
    },

    // Admin only: takes a game out of the whole group's collection. `updates` is [{ playerId, games }],
    // the list each player who had it should have afterwards.
    async removeSharedGame(key, updates) {
      state.sharedGames = state.sharedGames.filter((g) => g.key !== key);
      for (const { playerId, games } of updates) if (state.players[playerId]) state.players[playerId].games = games;
      persist(); emit(); emitShared();
    },

    // Feedback from the "Send feedback" link. Only the Admin page reads it.
    subscribeFeedback(fn) {
      feedbackListeners.add(fn);
      queueMicrotask(() => fn(feedbackRows()));
      return () => feedbackListeners.delete(fn);
    },

    async sendFeedback({ message, name, by }) {
      state.feedback.push({ id: newId('fb'), message, name, by, createdAt: Date.now(), seen: false });
      persist(); emitFeedback();
    },

    async markFeedback(id, seen) {
      const f = state.feedback.find((x) => x.id === id);
      if (f) f.seen = seen;
      persist(); emitFeedback();
    },

    async deleteFeedback(id) {
      state.feedback = state.feedback.filter((f) => f.id !== id);
      persist(); emitFeedback();
    },

    // Admin only: tidying old days.
    async listDayKeys() { return Object.keys(state.days); },

    async deleteDays(keys) {
      for (const k of keys) delete state.days[k];
      persist(); emit();
    },

    // Admin only: puts a backup back (see restoreOps in admin.js). Writes entries under the id they had
    // and deletes nothing.
    async restoreAll(ops, onProgress) {
      const upsert = (list, row, keyOf) => { const i = list.findIndex((x) => keyOf(x) === keyOf(row)); if (i >= 0) list[i] = row; else list.push(row); };
      ops.forEach(({ col, id, data }, i) => {
        if (col === 'players') state.players[id] = { id, ...data };
        else if (col === 'days') state.days[id] = data;
        else if (col === 'campaigns') upsert(state.campaigns, { ...data, id, createdAt: toMs(data.createdAt) }, (x) => x.id);
        else if (col === 'plays') upsert(state.plays, { ...data, id, createdAt: toMs(data.createdAt) }, (x) => x.id);
        else if (col === 'sharedGames') upsert(state.sharedGames, { ...data, key: id, createdAt: toMs(data.createdAt) }, (x) => x.key);
        onProgress?.(i + 1, ops.length);
      });
      persist(); emit(); emitPlays(); emitCampaigns(); emitShared();
    },

    // `people` is [{ id, name }]
    async addCampaignPlayers(id, people) {
      const c = state.campaigns.find((x) => x.id === id);
      for (const p of people) {
        if (!c.players.includes(p.id)) c.players.push(p.id);
        c.names = { ...c.names, [p.id]: p.name };
      }
      persist(); emitCampaigns();
    },

    async removeCampaignPlayer(id, playerId) {
      const c = state.campaigns.find((x) => x.id === id);
      c.players = c.players.filter((p) => p !== playerId);
      const { [playerId]: _gone, ...names } = c.names ?? {};
      c.names = names;
      persist(); emitCampaigns();
    },

    async deleteCampaign(id) {
      state.campaigns = state.campaigns.filter((c) => c.id !== id);
      persist(); emitCampaigns();
    },

    // The demo has no accounts, so everyone gets the admin tools to try out.
    subscribeAdmin(fn) {
      fn({ canSignIn: false, signedIn: false, checking: false, isAdmin: true, uid: null });
      return () => {};
    },

    reset() {
      try { localStorage.removeItem(KEY); } catch { /* ignore */ }
    },
  };
}
