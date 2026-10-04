// Smooth vector icons on a 24x24 grid. They draw in `currentColor`, so they invert
// along with whatever they sit on. (The player avatars are separate, and stay pixel art.)

const LINE = 'fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"';

// One half of the meeple; the other half is the same shape mirrored.
const MEEPLE_HALF = 'M12 8.8H9.8C7.8 9.4 6.6 10.3 4.8 10.6C3.2 10.9 2.6 11.6 2.6 12.6C2.6 13.8 3.8 14.3 5.4 14.3'
  + 'C6.8 14.3 7.6 14.4 7.9 15C8.3 15.9 7.4 17.4 6.4 19C5.8 20 6 21 7.2 21H10.6C11.4 21 11.7 20.4 12 19.4Z';

const ICONS = {
  check: `<path ${LINE} d="M4.5 12.5l5 5 10-11"/>`,
  plus: `<path ${LINE} d="M12 4.5v15M4.5 12h15"/>`,
  x: `<path ${LINE} d="M6 6l12 12M18 6L6 18"/>`,
  arrow: `<path ${LINE} d="M7 17L17 7M9 7h8v8"/>`,
  star: '<path fill="currentColor" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" '
    + 'd="M12 2.8l2.8 5.9 6.4.9-4.7 4.5 1.2 6.4L12 17.4l-5.7 3.1 1.2-6.4-4.7-4.5 6.4-.9z"/>',
  staroutline: '<path fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round" '
    + 'd="M12 2.8l2.8 5.9 6.4.9-4.7 4.5 1.2 6.4L12 17.4l-5.7 3.1 1.2-6.4-4.7-4.5 6.4-.9z"/>',
  bell: `<path ${LINE} stroke-width="2.6" d="M6.2 9a5.8 5.8 0 0 1 11.6 0c0 6.4 2.7 8.2 2.7 8.2h-17S6.2 15.4 6.2 9z"/>`
    + `<path ${LINE} stroke-width="2.6" d="M10.2 20.8a2 2 0 0 0 3.6 0"/>`,
  flag: `<path ${LINE} stroke-width="2.4" d="M5.5 21V3.5"/>`
    + `<path ${LINE} stroke-width="2.4" d="M5.5 4.5h12.5l-2.4 4 2.4 4H5.5"/>`,
  chevron: `<path ${LINE} stroke-width="2.8" d="M6 9l6 6 6-6"/>`,
  pin: `<path ${LINE} stroke-width="2.4" d="M12 21s-6.5-5.7-6.5-11a6.5 6.5 0 1 1 13 0c0 5.3-6.5 11-6.5 11z"/>`
    + '<circle fill="currentColor" cx="12" cy="10" r="2.2"/>',
  clock: `<circle ${LINE} stroke-width="2.4" cx="12" cy="12" r="9"/>`
    + `<path ${LINE} stroke-width="2.4" d="M12 7v5.2l3.2 2"/>`,
  calendar: `<rect ${LINE} stroke-width="2.4" x="3.5" y="5" width="17" height="15.5" rx="3"/>`
    + `<path ${LINE} stroke-width="2.4" d="M3.5 10.5h17M8 3v4M16 3v4"/>`,
  box: `<path ${LINE} stroke-width="2.4" d="M20.5 7.8L12 3.5 3.5 7.8v8.4l8.5 4.3 8.5-4.3z"/>`
    + `<path ${LINE} stroke-width="2.4" d="M3.5 7.8L12 12l8.5-4.2M12 12v8.5"/>`,
  trophy: `<path ${LINE} stroke-width="2.4" d="M7.5 4h9v5.2a4.5 4.5 0 0 1-9 0z"/>`
    + `<path ${LINE} stroke-width="2.4" d="M7.5 6H4.2v1.6a3.4 3.4 0 0 0 3.3 3.4M16.5 6h3.3v1.6a3.4 3.4 0 0 1-3.3 3.4"/>`
    + `<path ${LINE} stroke-width="2.4" d="M12 13.7V17M9.5 17h5M8.5 20.5h7"/>`,
  help: `<circle ${LINE} stroke-width="2.4" cx="12" cy="12" r="9"/>`
    + `<path ${LINE} stroke-width="2.4" d="M9.4 9.4a2.7 2.7 0 1 1 3.9 2.4c-.9.5-1.3 1-1.3 2"/>`
    + '<circle fill="currentColor" cx="12" cy="17.2" r="1.35"/>',
  up: '<path fill="currentColor" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" d="M12 4.2l8 9.6h-5v6H9v-6H4z"/>',
  sun: `<circle ${LINE} stroke-width="2.6" cx="12" cy="12" r="4.2"/>`
    + `<path ${LINE} stroke-width="2.6" d="M12 2.6v2.2M12 19.2v2.2M2.6 12h2.2M19.2 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M18.7 5.3l-1.6 1.6M6.9 17.1l-1.6 1.6"/>`,
  moon: `<path ${LINE} stroke-width="2.6" d="M20.2 14.6A8.4 8.4 0 1 1 9.4 3.8a6.6 6.6 0 0 0 10.8 10.8z"/>`,
  dice: `<rect ${LINE} stroke-width="2.4" x="3.5" y="3.5" width="17" height="17" rx="4"/>`
    + '<g fill="currentColor"><circle cx="8.3" cy="8.3" r="1.5"/><circle cx="15.7" cy="8.3" r="1.5"/>'
    + '<circle cx="12" cy="12" r="1.5"/><circle cx="8.3" cy="15.7" r="1.5"/><circle cx="15.7" cy="15.7" r="1.5"/></g>',
  lock: `<rect ${LINE} stroke-width="2.4" x="4.8" y="10.5" width="14.4" height="10" rx="2.6"/>`
    + `<path ${LINE} stroke-width="2.4" d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/>`,
  unlock: `<rect ${LINE} stroke-width="2.4" x="4.8" y="10.5" width="14.4" height="10" rx="2.6"/>`
    + `<path ${LINE} stroke-width="2.4" d="M8 10.5V8a4 4 0 0 1 7.6-1.7"/>`,
  meeple: `<g fill="currentColor"><circle cx="12" cy="5.4" r="3.2"/><path d="${MEEPLE_HALF}"/>`
    + `<path transform="matrix(-1 0 0 1 24 0)" d="${MEEPLE_HALF}"/></g>`,
};

export const iconInner = (name) => ICONS[name];

// `scale` is a size multiplier: 2 gives an 18px icon, 3 gives 27px.
export function icon(name, scale = 2) {
  const size = scale * 9;
  return `<svg class="ico" viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true" focusable="false">${ICONS[name]}</svg>`;
}
