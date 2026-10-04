// Pixel avatars: a 32-bit number becomes a mirrored 8x8 sprite (4 columns of
// bits, reflected). The number is all we store per player.

const popcount = (n) => {
  let c = 0;
  for (; n; n >>>= 1) c += n & 1;
  return c;
};

// Every player also gets a pale tint (a hue, 0 to 359) taken from their sprite, so
// people are easier to tell apart at a glance. Nothing extra is stored.
export const hueOf = (seed) => (Number(seed) >>> 0) % 360;

const hueGap = (a, b) => {
  const d = Math.abs(a - b) % 360;
  return Math.min(d, 360 - d);
};

// Random seed with a pleasant density (not nearly empty, not a solid block). Pass the
// hues that are already taken and it picks a face whose tint is clearly different.
export function randomSeed(takenHues = []) {
  const buf = new Uint32Array(1);
  const wanted = Math.min(45, 180 / (takenHues.length + 1));
  let best = null;
  for (let tries = 0; tries < 300; tries++) {
    crypto.getRandomValues(buf);
    const bits = popcount(buf[0]);
    if (bits < 13 || bits > 20) continue;
    const gap = takenHues.length ? Math.min(...takenHues.map((h) => hueGap(h, hueOf(buf[0])))) : 360;
    if (gap >= wanted) return buf[0];
    if (!best || gap > best.gap) best = { seed: buf[0], gap };
  }
  return best ? best.seed : randomSeed();
}

function spritePath(seed) {
  const n = Number(seed) >>> 0;
  let d = '';
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 4; x++) {
      if ((n >>> (y * 4 + x)) & 1) d += `M${x} ${y}h1v1h-1zM${7 - x} ${y}h1v1h-1z`;
    }
  }
  return d;
}

// `size` is in CSS pixels. Pass `label` to expose a tooltip / accessible name.
export function avatar(seed, size = 24, label = '') {
  const title = label ? ` title="${label.replace(/"/g, '&quot;')}"` : '';
  return `<span class="av" style="--s:${size}px;--h:${hueOf(seed)}"${title}><svg viewBox="0 0 8 8" shape-rendering="crispEdges" aria-hidden="true"><path fill="currentColor" d="${spritePath(seed)}"/></svg></span>`;
}
