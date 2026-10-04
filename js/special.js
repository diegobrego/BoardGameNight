// Special days: days an admin marks with a short note (a public holiday, a game's release...).
// The note shows on the day in the calendar, and the day gets thin diagonal lines. They are stored one to a
// day, in specialDays/{YYYY-MM-DD}, as { note }. These helpers only reshape data, so they can be tested alone.

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const NOTE_MAX = 50;
export const AHEAD_DAYS = 1100;       // about three years: how far ahead a special day can be set

const isRealDate = (key) => {
  const [y, m, d] = key.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
};

// The "add a special day" form -> { date, note }, or the first thing wrong with it.
//   form: { date, note }     today / last: "YYYY-MM-DD" limits     editing: an existing one may be in the past
export function buildSpecialDay(form, { today = null, last = null, editing = false } = {}) {
  const date = form.date ?? '';
  if (!DATE_RE.test(date) || !isRealDate(date)) return { error: 'Choose the day.' };
  if (!editing && today && date < today) return { error: 'That day has already passed.' };
  if (last && date > last) return { error: "That's too far ahead (about three years at most)." };

  const note = (form.note ?? '').trim().replace(/\s+/g, ' ');
  if (!note) return { error: 'Write a short note to show on the day.' };
  if (note.length > NOTE_MAX) return { error: `The note is a bit long (${NOTE_MAX} characters at most).` };
  return { date, note };
}

// [{ date, note }] -> { [date]: note }, for looking a day up.
export const specialMap = (rows) => Object.fromEntries(rows.map((r) => [r.date, r.note]));

// Today and later (soonest first), and the ones already gone by (latest first). Keys are ISO dates, so
// text order is date order.
export function splitSpecialDays(rows, todayKey) {
  const upcoming = rows.filter((r) => r.date >= todayKey).sort((a, b) => a.date.localeCompare(b.date));
  const past = rows.filter((r) => r.date < todayKey).sort((a, b) => b.date.localeCompare(a.date));
  return { upcoming, past };
}

// ---------------------------------------------------------------------------
// the public holidays of Bavaria ("Feiertage"), so an admin doesn't have to type them in
// ---------------------------------------------------------------------------

// Easter Sunday of a year (the usual Gauss / "Anonymous Gregorian" calculation): { month, day }.
function easterSunday(year) {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);      // 3 = March, 4 = April
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return { month, day };
}

const pad = (n) => String(n).padStart(2, '0');
const isoDate = (date) => `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;

// The statutory public holidays in Bavaria in one year, oldest first: [{ date, note }]. The ones that move
// with Easter are worked out. (Mariä Himmelfahrt, 15 August, only counts in towns with a mostly Catholic
// population, which is most of Bavaria; Augsburg's Friedensfest on 8 August and other local days are left out.)
export function bavarianHolidays(year) {
  const { month, day } = easterSunday(year);
  const afterEaster = (n) => isoDate(new Date(Date.UTC(year, month - 1, day + n)));
  return [
    { date: `${year}-01-01`, note: 'Neujahr' },
    { date: `${year}-01-06`, note: 'Heilige Drei Könige' },
    { date: afterEaster(-2), note: 'Karfreitag' },
    { date: afterEaster(1), note: 'Ostermontag' },
    { date: `${year}-05-01`, note: 'Tag der Arbeit' },
    { date: afterEaster(39), note: 'Christi Himmelfahrt' },
    { date: afterEaster(50), note: 'Pfingstmontag' },
    { date: afterEaster(60), note: 'Fronleichnam' },
    { date: `${year}-08-15`, note: 'Mariä Himmelfahrt' },
    { date: `${year}-10-03`, note: 'Tag der Deutschen Einheit' },
    { date: `${year}-11-01`, note: 'Allerheiligen' },
    { date: `${year}-12-25`, note: '1. Weihnachtstag' },
    { date: `${year}-12-26`, note: '2. Weihnachtstag' },
  ].sort((x, y) => x.date.localeCompare(y.date));
}

// The Bavarian public holidays from one day to another (both included), soonest first.
export function holidaysBetween(fromKey, toKey) {
  const rows = [];
  for (let year = Number(fromKey.slice(0, 4)); year <= Number(toKey.slice(0, 4)); year++) {
    rows.push(...bavarianHolidays(year).filter((h) => h.date >= fromKey && h.date <= toKey));
  }
  return rows;
}
