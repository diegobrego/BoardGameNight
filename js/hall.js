// Numbers for the hall of fame. It only does arithmetic on the list of logged games,
// so it can be tested on its own.
//
// A "play" is one game played on a game night:
//   { date: "2026-10-09", game: { name }, winner: playerId | null, players: [playerId] }
// Wins count games won. Participation counts game *nights* a player took part in (not
// games), so a long night with three games still counts once.

export function tally(plays) {
  const wins = new Map();
  const nights = new Map();
  const dates = new Set();
  for (const play of plays) {
    dates.add(play.date);
    for (const id of play.players ?? []) {
      if (!nights.has(id)) nights.set(id, new Set());
      nights.get(id).add(play.date);
    }
    if (play.winner) wins.set(play.winner, (wins.get(play.winner) ?? 0) + 1);
  }
  return {
    wins: [...wins].map(([id, n]) => ({ id, n })),
    nights: [...nights].map(([id, set]) => ({ id, n: set.size })),
    nightCount: dates.size,
    gameCount: plays.length,
  };
}

// Highest first. Equal scores share a rank (1, 1, 3) and are ordered by name.
export function ranked(list, nameOf) {
  const sorted = [...list].sort((a, b) => b.n - a.n || nameOf(a.id).localeCompare(nameOf(b.id)));
  let rank = 0;
  return sorted.map((row, i) => {
    if (i === 0 || row.n !== sorted[i - 1].n) rank = i + 1;
    return { ...row, rank };
  });
}

export const newestFirst = (plays) => [...plays].sort(
  (a, b) => b.date.localeCompare(a.date) || (b.createdAt ?? 0) - (a.createdAt ?? 0),
);
