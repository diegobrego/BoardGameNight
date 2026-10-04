// Rebuild data/games.json from the public BGG ranking dump (beefsack/bgg-ranking-historicals).
//
// Usage:  node tools/update-games.mjs [YYYY-MM-DD]
// Output: data/games.json  ->  [[bggId, name, year, usersRated], ...] sorted by popularity.

import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const MIN_RATINGS = 150; // skip obscure entries to keep the file small

const day = process.argv[2] ?? new Date().toISOString().slice(0, 10);
const url = `https://raw.githubusercontent.com/beefsack/bgg-ranking-historicals/master/${day}.csv`;
console.log('Fetching', url);
const res = await fetch(url);
if (!res.ok) throw new Error(`HTTP ${res.status} - try yesterday's date`);
const text = await res.text();

// Minimal CSV parser (handles quoted fields with commas and "" escapes).
function parseCsv(src) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const [header, ...body] = parseCsv(text);
const col = Object.fromEntries(header.map((h, i) => [h, i]));
const games = [];
for (const r of body) {
  const id = parseInt(r[col['ID']], 10);
  const rated = parseInt(r[col['Users rated']], 10) || 0;
  const year = parseInt(r[col['Year']], 10) || 0;
  const name = (r[col['Name']] ?? '').trim();
  if (!id || !name || rated < MIN_RATINGS) continue;
  games.push([id, name, year, rated]);
}
games.sort((a, b) => b[3] - a[3]);

const out = fileURLToPath(new URL('../data/games.json', import.meta.url));
const json = JSON.stringify(games);
await writeFile(out, json, 'utf8');
console.log(`Wrote ${games.length} games (${(json.length / 1024).toFixed(0)} KB) to ${out}`);
