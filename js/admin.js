// Helpers for the Admin page: the backup file, and turning the "edit a hall-of-fame entry" form
// into a play. They only reshape data, so they can be tested on their own.

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
export function buildBackup({ players = {}, days = {}, plays = [], campaigns = [] }, now = new Date()) {
  return {
    app: 'board-game-night',
    format: 1,
    exportedAt: now.toISOString(),
    counts: {
      players: Object.keys(players).length,
      days: Object.keys(days).length,
      plays: plays.length,
      campaigns: campaigns.length,
    },
    players,
    days,
    plays,
    campaigns,
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
