// Numbers for the hall of fame and the player cards. It only does arithmetic on the list of
// logged games, so it can be tested on its own.
//
// A "play" is one game played on a game night:
//   { date: "2026-10-09", game: { id, name }, winner: playerId | null, players: [playerId] }
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

const gameKey = (play) => String(play.game?.id ?? (play.game?.name ?? '').toLowerCase());

// The game that shows up most in a list of plays: { name, n }, or null for an empty list.
function mostCommonGame(plays) {
  const counts = new Map();
  for (const play of plays) {
    const key = gameKey(play);
    const entry = counts.get(key) ?? { name: play.game?.name ?? 'Unknown game', n: 0 };
    entry.n += 1;
    counts.set(key, entry);
  }
  return [...counts.values()].sort((a, b) => b.n - a.n || a.name.localeCompare(b.name))[0] ?? null;
}

// Everything about one player, for their card. The win rate only counts games that had a
// winner (nobody "loses" a co-op game), so playing Pandemic doesn't drag it down.
export function playerStats(plays, id) {
  const mine = plays.filter((p) => p.players?.includes(id));
  const won = mine.filter((p) => p.winner === id);
  const contested = mine.filter((p) => p.winner != null);
  return {
    games: mine.length,
    wins: won.length,
    contested: contested.length,
    winRate: contested.length ? won.length / contested.length : null,
    nights: new Set(mine.map((p) => p.date)).size,
    favourite: mostCommonGame(mine),
    bestAt: mostCommonGame(won),
    recent: newestFirst(mine).slice(0, 5).map((p) => ({
      date: p.date,
      game: p.game?.name ?? 'Unknown game',
      result: p.winner === id ? 'won' : p.winner == null ? 'no winner' : 'played',
      campaign: Boolean(p.campaign),
    })),
  };
}

// Titles for the current leaders (ties share a title):
//   Champion      most wins
//   Regular       most game nights (at least 2)
//   Sharpshooter  best win rate (at least 3 games with a winner, and at least one win)
// Returns Map(playerId -> [title, ...]).
export function awardTitles(plays) {
  const { wins, nights } = tally(plays);
  const titles = new Map();
  const give = (ids, title) => ids.forEach((id) => titles.set(id, [...(titles.get(id) ?? []), title]));
  const leaders = (rows) => {
    const top = Math.max(0, ...rows.map((r) => r.n));
    return top > 0 ? rows.filter((r) => r.n === top).map((r) => r.id) : [];
  };

  give(leaders(wins), 'Champion');
  give(leaders(nights.filter((r) => r.n >= 2)), 'Regular');

  const rates = nights
    .map(({ id }) => ({ id, ...playerStats(plays, id) }))
    .filter((s) => s.contested >= 3 && s.wins > 0)
    .map((s) => ({ id: s.id, rate: s.winRate }));
  const best = Math.max(0, ...rates.map((r) => r.rate));
  if (best > 0) give(rates.filter((r) => r.rate === best).map((r) => r.id), 'Sharpshooter');
  return titles;
}
