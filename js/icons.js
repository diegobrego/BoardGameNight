// Tiny 1-bit pixel icons. Each icon is a bitmap; "#" is a lit pixel.
// They draw in `currentColor`, so they invert along with their surroundings.

const BITMAPS = {
  check: [
    '......##',
    '.....##.',
    '##..##..',
    '.####...',
    '..##....',
  ],
  plus: [
    '...##...',
    '...##...',
    '...##...',
    '########',
    '########',
    '...##...',
    '...##...',
    '...##...',
  ],
  x: [
    '##....##',
    '###..###',
    '.######.',
    '..####..',
    '..####..',
    '.######.',
    '###..###',
    '##....##',
  ],
  star: [
    '....#....',
    '....#....',
    '...###...',
    '#########',
    '.#######.',
    '..#####..',
    '.###.###.',
    '.##...##.',
  ],
  arrow: [
    '....###',
    '.....##',
    '....###',
    '...##..',
    '..##...',
    '.##....',
    '##.....',
  ],
  dice: [
    '#######',
    '#.....#',
    '#.#.#.#',
    '#..#..#',
    '#.#.#.#',
    '#.....#',
    '#######',
  ],
  meeple: [
    '....###....',
    '...#####...',
    '...#####...',
    '....###....',
    '..#######..',
    '###########',
    '###########',
    '.#########.',
    '..#######..',
    '.####.####.',
    '.###...###.',
  ],
};

export function iconPath(name) {
  const rows = BITMAPS[name];
  let d = '';
  rows.forEach((row, y) => {
    for (const run of row.matchAll(/#+/g)) d += `M${run.index} ${y}h${run[0].length}v1h-${run[0].length}z`;
  });
  return { d, w: rows[0].length, h: rows.length };
}

export function icon(name, scale = 2) {
  const { d, w, h } = iconPath(name);
  return `<svg class="px" viewBox="0 0 ${w} ${h}" width="${w * scale}" height="${h * scale}" shape-rendering="crispEdges" aria-hidden="true" focusable="false"><path fill="currentColor" d="${d}"/></svg>`;
}
