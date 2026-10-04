// A player's collection: the games they own or love, kept on their profile (players/{id}.games)
// so they can be picked on any day without searching. A game here is { id, name, year } like a
// game on a day's list, plus `fav: true` when it's marked as a favourite (left out otherwise).
// It only reshapes data, so it can be tested on its own.

import { normalize, voteKey } from './games.js';

// Keep in step with the size limit in firestore.rules.
export const MAX_MY_GAMES = 60;

export const cleanGame = (g) => ({ id: g.id ?? null, name: g.name, year: g.year || 0, ...(g.fav ? { fav: true } : {}) });

export const hasGame = (list, game) => list.some((g) => voteKey(g) === voteKey(game));

// The list with the game added, or `null` when it's already there or the list is full.
export function withGame(list, game) {
  if (hasGame(list, game) || list.length >= MAX_MY_GAMES) return null;
  return [...list, cleanGame(game)];
}

export const withoutGame = (list, key) => list.filter((g) => voteKey(g) !== key);

// The list with one game's favourite mark flipped.
export const toggleFav = (list, key) => list.map((g) => (voteKey(g) === key ? cleanGame({ ...g, fav: !g.fav }) : g));

// Favourites first, then A to Z.
export const ordered = (list) => [...list].sort((a, b) => (b.fav ? 1 : 0) - (a.fav ? 1 : 0) || a.name.localeCompare(b.name));

// Games from the list that match what was typed (all of them for an empty search): names that
// start with it first, then favourites, then A to Z. Ignores case, accents and punctuation.
export function matchMine(list, query) {
  const q = normalize(query ?? '');
  if (!q) return ordered(list);
  const starts = (g) => (normalize(g.name).startsWith(q) ? 0 : 1);
  return ordered(list.filter((g) => normalize(g.name).includes(q))).sort((a, b) => starts(a) - starts(b));
}
