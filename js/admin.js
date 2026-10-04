// Helpers for the Admin page: the backup file, and turning the "edit a hall-of-fame entry" form
// into a play. They only reshape data, so they can be tested on their own.

import { NOTE_MAX } from './special.js';

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Firestore hands back timestamps as objects; a backup wants plain text. Turns those (anywhere
// inside) into ISO dates and leaves everything else as it was.
export function toPlain(value) {
  if (value === null || typeof value !== 'object') return value;
  if (typeof value.toMillis === 'function') return new Date(value.toMillis()).toISOString();
  if (Array.isArray(value)) return value.map(toPlain);
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, toPlain(v)]));
}

// Everything the site stores, in one file. Admin accounts are left out on purpose.
export function buildBackup({ players = {}, days = {}, plays = [], campaigns = [], sharedGames = [], specialDays = [] }, now = new Date()) {
  return {
    app: 'board-game-night',
    format: 1,
    exportedAt: now.toISOString(),
    counts: {
      players: Object.keys(players).length,
      days: Object.keys(days).length,
      plays: plays.length,
      campaigns: campaigns.length,
      sharedGames: sharedGames.length,
      specialDays: specialDays.length,
    },
    players,
    days,
    plays,
    campaigns,
    sharedGames,
    specialDays,
  };
}

export const backupName = (now = new Date()) => `board-game-night-backup-${now.toISOString().slice(0, 10)}.json`;

// A copy without the keys that are `undefined` (the database refuses those when adding a document).
export const withoutUndefined = (obj) => Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));

// The "edit a hall-of-fame entry" form -> a play, or the first thing wrong with it.
//   form: { date, game: { id, name, year }, players: Set | [id], winner (undefined: not chosen, null: nobody),
//           campaign, note }
//   nameOf(id): the name to remember for a player
// A cleared note or campaign comes back as `undefined`, which an update turns into "remove it".
export function buildPlay(form, { today = null, nameOf = (id) => id } = {}) {
  if (!DATE_RE.test(form.date ?? '')) return { error: 'Choose the date.' };
  if (today && form.date > today) return { error: "That date hasn't happened yet." };

  const name = (form.game?.name ?? '').trim();
  if (!name) return { error: 'Choose the game that was played.' };
  if (name.length > 100) return { error: 'That game name is too long (100 characters at most).' };

  const ids = [...(form.players ?? [])];
  if (!ids.length) return { error: 'Tick the players who took part.' };
  if (ids.length > 30) return { error: 'That is a lot of players (30 at most).' };

  if (form.winner === undefined) return { error: 'Choose who won, or "Nobody" for a co-op game or a draw.' };
  if (form.winner !== null && !ids.includes(form.winner)) return { error: 'The winner has to be one of the players.' };

  const note = (form.note ?? '').trim().replace(/\s+/g, ' ');
  if (note.length > 140) return { error: 'The note is a bit long (140 characters at most).' };

  return {
    play: {
      date: form.date,
      game: { id: form.game.id ?? null, name, year: form.game.year || 0 },
      winner: form.winner,
      players: ids,
      names: Object.fromEntries(ids.map((id) => [id, nameOf(id)])),
      note: note || undefined,
      campaign: form.campaign || undefined,
    },
  };
}

// ---------------------------------------------------------------------------
// restoring a backup
// ---------------------------------------------------------------------------

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// Reads a backup file's text. Either `{ error }` (what is wrong with it, in plain words), or
// `{ backup, summary }`: the backup, tidied, and what is in it. Nothing is written here.
export function parseBackup(text) {
  let data;
  try { data = JSON.parse(text); } catch { return { error: "That file isn't a backup: it can't be read as a backup file." }; }
  if (!isObject(data) || data.app !== 'board-game-night') return { error: "That file isn't a Board Game Night backup." };
  if (typeof data.format !== 'number' || data.format > 1) return { error: 'That backup comes from a newer version of the site than this one.' };

  const players = data.players ?? {};
  const days = data.days ?? {};
  const plays = data.plays ?? [];
  const campaigns = data.campaigns ?? [];
  const sharedGames = data.sharedGames ?? [];
  const specialDays = data.specialDays ?? [];
  if (!isObject(players) || !isObject(days)) return { error: 'That backup is damaged (the players or days are not in the right shape).' };
  if (![plays, campaigns, sharedGames, specialDays].every(Array.isArray)) return { error: 'That backup is damaged (the games or campaigns are not in the right shape).' };

  for (const [id, p] of Object.entries(players)) {
    if (!id || !isObject(p) || typeof p.name !== 'string' || !p.name) return { error: `That backup is damaged: a player (${id}) has no name.` };
  }
  for (const [key, d] of Object.entries(days)) {
    if (!DATE_RE.test(key) || !isObject(d)) return { error: `That backup is damaged: "${key}" is not a day.` };
  }
  for (const p of plays) {
    if (!isObject(p) || typeof p.id !== 'string' || !DATE_RE.test(p.date ?? '') || typeof p.game?.name !== 'string' || !Array.isArray(p.players)) {
      return { error: 'That backup is damaged: one of the logged games is incomplete.' };
    }
  }
  for (const c of campaigns) {
    if (!isObject(c) || typeof c.id !== 'string' || typeof c.game?.name !== 'string' || typeof c.title !== 'string' || !Array.isArray(c.players)) {
      return { error: 'That backup is damaged: one of the campaigns is incomplete.' };
    }
  }
  for (const s of sharedGames) {
    if (!isObject(s) || typeof s.id !== 'string' || typeof s.name !== 'string') return { error: 'That backup is damaged: one of the shared games is incomplete.' };
  }

  for (const s of specialDays) {
    if (!isObject(s) || !DATE_RE.test(s.id ?? '') || typeof s.note !== 'string' || !s.note || s.note.length > NOTE_MAX) {
      return { error: 'That backup is damaged: one of the special days is incomplete.' };
    }
  }

  const backup = { players, days, plays, campaigns, sharedGames, specialDays };
  return {
    backup,
    summary: {
      exportedAt: typeof data.exportedAt === 'string' ? data.exportedAt : null,
      counts: { players: Object.keys(players).length, days: Object.keys(days).length, plays: plays.length, campaigns: campaigns.length, sharedGames: sharedGames.length, specialDays: specialDays.length },
    },
  };
}

// The writes that put a backup back: [{ col, id, data }]. Players first, then days, campaigns, logged
// games, shared games and special days. Entries are written under the id they had, so a restore overwrites those and
// deletes nothing.
export function restoreOps(backup) {
  const ops = [];
  for (const [id, data] of Object.entries(backup.players ?? {})) ops.push({ col: 'players', id, data });
  for (const [id, data] of Object.entries(backup.days ?? {})) ops.push({ col: 'days', id, data });
  for (const { id, ...data } of backup.campaigns ?? []) ops.push({ col: 'campaigns', id, data });
  for (const { id, ...data } of backup.plays ?? []) ops.push({ col: 'plays', id, data });
  for (const { id, ...data } of backup.sharedGames ?? []) ops.push({ col: 'sharedGames', id, data });
  for (const { id, ...data } of backup.specialDays ?? []) ops.push({ col: 'specialDays', id, data });
  return ops;
}

// ---------------------------------------------------------------------------
// tidying old days
// ---------------------------------------------------------------------------

// The day `days` days before `todayKey` ("2026-10-04" and 30 gives "2026-09-04").
export function cutoffFor(todayKey, days) {
  const [y, m, d] = todayKey.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d - days));
  return date.toISOString().slice(0, 10);
}

// The days older than the cutoff (the cutoff day itself stays). Keys are ISO dates, so text order is date order.
export const oldDayKeys = (keys, cutoffKey) => keys.filter((k) => DATE_RE.test(k) && k < cutoffKey).sort();
