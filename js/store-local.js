// DEMO backend: everything lives in this browser's localStorage. Handy for trying
// the site out; nothing is shared with anyone. Seeds a few fake players on first run.

import { randomSeed, hueOf } from './avatar.js';
import { upcomingDays, dateKey } from './dates.js';
import { voteKey } from './games.js';

const KEY = 'bgn.demo.v2';

function seed() {
  const names = ['Mia', 'Leo', 'Zoe', 'Sam'];
  const players = {};
  const taken = [];   // pale tints already used, so the demo players look clearly different
  names.forEach((name, i) => {
    const avatar = randomSeed(taken);
    taken.push(hueOf(avatar));
    players[`demo${i}`] = { id: `demo${i}`, name, avatar };
  });
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

  // A few logged game nights, so the hall of fame has something to show.
  const daysAgo = (n) => {
    const t = new Date();
    return dateKey(new Date(t.getFullYear(), t.getMonth(), t.getDate() - n));
  };
  let n = 0;
  const play = (ago, game, winner, ids) => ({
    id: `seed${n++}`,
    date: daysAgo(ago),
    game,
    winner,
    players: ids,
    names: Object.fromEntries(ids.map((id) => [id, players[id].name])),
    loggedBy: ids[0],
    createdAt: Date.now() - ago * 86400000 + n,
  });
  const all = ['demo0', 'demo1', 'demo2', 'demo3'];
  const plays = [
    play(21, { id: 13, name: 'Catan', year: 1995 }, 'demo0', all),
    play(14, { id: 230802, name: 'Azul', year: 2017 }, 'demo1', ['demo0', 'demo1', 'demo2']),
    play(14, { id: 266192, name: 'Wingspan', year: 2019 }, 'demo2', ['demo0', 'demo1', 'demo2']),
    play(7, { id: 30549, name: 'Pandemic', year: 2008 }, null, all),
    play(7, { id: 68448, name: '7 Wonders', year: 2010 }, 'demo0', ['demo0', 'demo1', 'demo3']),
  ];
  return { players, days, plays };
}

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const saved = JSON.parse(raw);
      saved.plays ??= [];
      return saved;
    }
  } catch { /* fall through to a fresh seed */ }
  return seed();
}

export function create() {
  let state = load();
  const listeners = new Set();
  const playListeners = new Set();
  const persist = () => { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* private mode */ } };
  const emit = () => listeners.forEach((fn) => fn({ players: state.players, days: state.days, synced: true }));
  const emitPlays = () => playListeners.forEach((fn) => fn([...state.plays]));
  persist();

  // Keep several open tabs of the demo in step.
  window.addEventListener('storage', (e) => {
    if (e.key === KEY) { state = load(); emit(); emitPlays(); }
  });

  const day = (date) => (state.days[date] ??= { players: [], games: [] });
  const same = (a, b) => (a.id ?? a.name) === (b.id ?? b.name) && a.by === b.by;
  const toggled = (list = [], playerId, on) => (
    on ? [...list.filter((id) => id !== playerId), playerId] : list.filter((id) => id !== playerId)
  );

  return {
    mode: 'local',

    subscribe(fn) {
      listeners.add(fn);
      queueMicrotask(() => fn({ players: state.players, days: state.days, synced: true }));
      return () => listeners.delete(fn);
    },

    async addPlayer({ name, avatar }) {
      const id = `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
      state.players[id] = { id, name, avatar };
      persist(); emit();
      return id;
    },

    async updatePlayer(id, patch) {
      Object.assign(state.players[id], patch);
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
      const id = `play${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
      state.plays.push({ ...play, id, createdAt: Date.now() });
      persist(); emitPlays();
      return id;
    },

    async deletePlay(id) {
      state.plays = state.plays.filter((p) => p.id !== id);
      persist(); emitPlays();
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
