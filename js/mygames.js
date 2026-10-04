// A player's own list of favourite / owned games, kept on their profile (players/{id}.games) so
// they can be picked on any day without searching. It only reshapes data, so it can be tested
// on its own. A game here is { id, name, year }, the same shape as a game on a day's list.

import { normalize, voteKey } from './games.js';

// Keep in step with the size limit in firestore.rules.
export const MAX_MY_GAMES = 60;

export const cleanGame = (g) => ({ id: g.id ?? null, name: g.name, year: g.year || 0 });

export const hasGame = (list, game) => list.some((g) => voteKey(g) === voteKey(game));

// The list with the game added, or `null` when it's already there or the list is full.
export function withGame(list, game) {
  if (hasGame(list, game) || list.length >= MAX_MY_GAMES) return null;
  return [...list, cleanGame(game)];
}

export const withoutGame = (list, key) => list.filter((g) => voteKey(g) !== key);

export const byName = (list) => [...list].sort((a, b) => a.name.localeCompare(b.name));

// Games from the list that match what was typed (all of them for an empty search), A to Z, with
// the ones whose name starts with it first. Ignores case, accents and punctuation.
export function matchMine(list, query) {
  const q = normalize(query ?? '');
  if (!q) return byName(list);
  const hits = list.filter((g) => normalize(g.name).includes(q));
  const starts = (g) => (normalize(g.name).startsWith(q) ? 0 : 1);
  return byName(hits).sort((a, b) => starts(a) - starts(b));
}
