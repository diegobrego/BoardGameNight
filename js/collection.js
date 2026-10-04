// The group's collection: every game anyone has in their own collection, plus games that were
// played though nobody had listed them ("someone has got to own it to be able to play"). Nothing
// is stored twice: it is worked out from the players' collections (players/{id}.games) and the
// small list of played-but-unlisted games (sharedGames/{key}). So when a player takes a game off
// their list it leaves the group's collection too, unless someone else has it.
// It only reshapes data, so it can be tested on its own.

import { voteKey } from './games.js';

const plainGame = (g) => ({ id: g.id ?? g.gameId ?? null, name: g.name, year: g.year || 0 });

// One entry per game: { key, game: { id, name, year }, owners: [playerId], shared }
//   owners  the players who have it in their collection
//   shared  it was played without being in anyone's collection (it is in sharedGames)
// `shared` rows are { key?, gameId, name, year } as stored; `players` is { id: { id, games } }.
export function buildCatalog(players, shared = []) {
  const entries = new Map();
  const entry = (game) => {
    const key = voteKey(game);
    if (!entries.has(key)) entries.set(key, { key, game: plainGame(game), owners: [], shared: false });
    return entries.get(key);
  };
  for (const p of Object.values(players)) {
    for (const g of p.games ?? []) {
      const e = entry(g);
      if (!e.owners.includes(p.id)) e.owners.push(p.id);
    }
  }
  for (const s of shared) entry({ id: s.gameId ?? s.id ?? null, name: s.name, year: s.year }).shared = true;
  return [...entries.values()];
}

// The keys of every game the group has, for a quick "does anyone own this?" check.
export const ownedKeys = (players, shared = []) => new Set(buildCatalog(players, shared).map((e) => e.key));

// Nobody has it: not in any collection, and not in the shared list.
export const nobodyOwns = (game, owned) => !owned.has(voteKey(game));

// Games nobody has listed come first (they need a look), then A to Z.
export function sortCatalog(catalog) {
  return [...catalog].sort((a, b) => (a.owners.length ? 1 : 0) - (b.owners.length ? 1 : 0) || a.game.name.localeCompare(b.game.name));
}

// What it takes to remove a game from the whole group: every collection that has it, as the
// list each of those players should have afterwards: [{ playerId, games }].
export function withoutGameFrom(players, key) {
  return Object.values(players)
    .filter((p) => (p.games ?? []).some((g) => voteKey(g) === key))
    .map((p) => ({ playerId: p.id, games: p.games.filter((g) => voteKey(g) !== key) }));
}

// The document kept for a game that was played but nobody had listed (its id is the game's key).
export const sharedDoc = (game) => ({ gameId: game.id ?? null, name: game.name, year: game.year || 0, source: 'played' });
