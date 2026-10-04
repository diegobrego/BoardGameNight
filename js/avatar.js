// Pixel avatars: a 32-bit number becomes a mirrored 8x8 sprite (4 columns of
// bits, reflected). The number is all we store per player.

const popcount = (n) => {
  let c = 0;
  for (; n; n >>>= 1) c += n & 1;
  return c;
};

// Random seed with a pleasant density (not nearly empty, not a solid block).
export function randomSeed() {
  const buf = new Uint32Array(1);
  for (;;) {
    crypto.getRandomValues(buf);
    const bits = popcount(buf[0]);
    if (bits >= 13 && bits <= 20) return buf[0];
  }
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
  return `<span class="av" style="--s:${size}px"${title}><svg viewBox="0 0 8 8" shape-rendering="crispEdges" aria-hidden="true"><path fill="currentColor" d="${spritePath(seed)}"/></svg></span>`;
}
