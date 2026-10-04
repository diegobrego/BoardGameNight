// DEMO backend: everything lives in this browser's localStorage. Handy for trying
// the site out; nothing is shared with anyone. Seeds a few fake players on first run.

import { randomSeed } from './avatar.js';
import { upcomingDays } from './dates.js';

const KEY = 'bgn.demo.v1';

function seed() {
  const names = ['Mia', 'Leo', 'Zoe', 'Sam'];
  const players = {};
  names.forEach((name, i) => { players[`demo${i}`] = { id: `demo${i}`, name, avatar: randomSeed() }; });
  const keys = upcomingDays(7).map((d) => d.key);
  const days = {
    [keys[1]]: { players: ['demo0', 'demo1'], games: [] },
    [keys[3]]: {
      players: ['demo0', 'demo1', 'demo2'],
      games: [{ id: 13, name: 'Catan', year: 1995, by: 'demo0' }],
    },
    [keys[5]]: { players: ['demo1', 'demo2', 'demo3', 'demo0'], games: [] },
    [keys[6]]: { players: ['demo3'], games: [] },
  };
  return { players, days };
}

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* fall through to a fresh seed */ }
  return seed();
}

export function create() {
  let state = load();
  const listeners = new Set();
  const persist = () => { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* private mode */ } };
  const emit = () => listeners.forEach((fn) => fn({ players: state.players, days: state.days, synced: true }));
  persist();

  // Keep several open tabs of the demo in step.
  window.addEventListener('storage', (e) => {
    if (e.key === KEY) { state = load(); emit(); }
  });

  const day = (date) => (state.days[date] ??= { players: [], games: [] });
  const same = (a, b) => (a.id ?? a.name) === (b.id ?? b.name) && a.by === b.by;

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

    async removeGame(date, game) {
      const d = day(date);
      d.games = d.games.filter((g) => !same(g, game));
      persist(); emit();
    },

    reset() {
      try { localStorage.removeItem(KEY); } catch { /* ignore */ }
    },
  };
}
