// Game lookup. BoardGameGeek's own API needs a private token and blocks browser
// requests, so we ship a compact index of BGG games (data/games.json, built by
// tools/update-games.mjs) and search it locally. Links point at real BGG pages.

let index = null;
let loading = null;

export const normalize = (s) =>
  s.toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

export function loadGames() {
  loading ??= fetch(new URL('../data/games.json', import.meta.url))
    .then((r) => {
      if (!r.ok) throw new Error(`games.json: HTTP ${r.status}`);
      return r.json();
    })
    .then((rows) => {
      index = rows.map(([id, name, year]) => ({ id, name, year, norm: normalize(name) }));
      return index;
    })
    .catch((err) => {
      loading = null; // allow a retry next time the search opens
      throw err;
    });
  return loading;
}

export const isLoaded = () => index !== null;
export const findGame = (id) => index?.find((g) => g.id === id) ?? null;

export const bggUrl = (id) => `https://boardgamegeek.com/boardgame/${id}`;
export const bggSearchUrl = (q) =>
  `https://boardgamegeek.com/geeksearch.php?action=search&objecttype=boardgame&q=${encodeURIComponent(q)}`;

// Accepts a pasted BGG link and returns { id, slug } (slug may be null).
export function parseBggLink(text) {
  const m = text.match(/boardgamegeek\.com\/(?:boardgame|boardgameexpansion)\/(\d+)(?:\/([\w-]+))?/i);
  return m ? { id: Number(m[1]), slug: m[2] ?? null } : null;
}

export const titleFromSlug = (slug) =>
  slug.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

// Ranked: exact > starts-with > every word found (word starts win). Ties go to the
// more popular game, because the index is already sorted by popularity.
export function searchGames(query, limit = 8) {
  if (!index) return [];
  const q = normalize(query);
  if (q.length < 2) return [];
  const tokens = q.split(' ');
  const hits = [];
  for (let i = 0; i < index.length; i++) {
    const g = index[i];
    let score;
    if (g.norm === q) score = 1000;
    else if (g.norm.startsWith(q)) score = 600;
    else {
      score = 0;
      for (const t of tokens) {
        const at = g.norm.indexOf(t);
        if (at < 0) { score = -1; break; }
        score += at === 0 || g.norm[at - 1] === ' ' ? 40 : 10;
      }
      if (score < 0) continue;
    }
    hits.push([score - i * 0.002, g]);
  }
  hits.sort((a, b) => b[0] - a[0]);
  return hits.slice(0, limit).map((h) => h[1]);
}
