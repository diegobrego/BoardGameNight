// The "How it works" page (help.html) is plain HTML. This only fills in the little vector icons
// (so they match the rest of the site) and runs the light / dark button.

import { icon } from './icons.js';

const THEME_KEY = 'bgn.theme';
const get = (key) => { try { return localStorage.getItem(key); } catch { return null; } };
const set = (key, value) => { try { localStorage.setItem(key, value); } catch { /* private mode */ } };

for (const el of document.querySelectorAll('[data-icon]')) {
  el.innerHTML = icon(el.dataset.icon, Number(el.dataset.size) || 2);
}
document.getElementById('brand-icon').innerHTML = icon('meeple', 3);

const root = document.documentElement;
const button = document.getElementById('theme-btn');

function applyTheme(theme, remember) {
  root.dataset.theme = theme;
  if (remember) set(THEME_KEY, theme);
  const dark = theme === 'dark';
  button.innerHTML = icon(dark ? 'sun' : 'moon', 2);
  button.setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode');
  button.title = dark ? 'Switch to light mode' : 'Switch to dark mode';
  document.querySelector('meta[name="theme-color"]').content = getComputedStyle(root).getPropertyValue('--solid').trim();
}

applyTheme(root.dataset.theme === 'dark' ? 'dark' : 'light', false);
button.addEventListener('click', () => applyTheme(root.dataset.theme === 'dark' ? 'light' : 'dark', true));

const darkQuery = window.matchMedia?.('(prefers-color-scheme: dark)');
darkQuery?.addEventListener?.('change', () => {
  const saved = get(THEME_KEY);
  if (saved !== 'light' && saved !== 'dark') applyTheme(darkQuery.matches ? 'dark' : 'light', false);
});
