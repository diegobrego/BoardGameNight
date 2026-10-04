const DOW = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const MONTH = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

const pad = (n) => String(n).padStart(2, '0');

// Local calendar date -> "2026-10-04". Never goes through UTC, so it can't shift a day.
export const dateKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

const describe = (date, { isToday = false, isPast = false } = {}) => ({
  key: dateKey(date),
  date,
  dow: DOW[date.getDay()],
  num: date.getDate(),
  month: MONTH[date.getMonth()],
  isToday,
  isPast,
  isWeekend: date.getDay() === 0 || date.getDay() === 6,
});

// Today and the days after it.
export function upcomingDays(count, from = new Date()) {
  return Array.from({ length: count }, (_, i) => describe(
    new Date(from.getFullYear(), from.getMonth(), from.getDate() + i),
    { isToday: i === 0 },
  ));
}

// The `count` days before today, oldest first (so "last week" reads from a week ago to yesterday).
export function pastDays(count, from = new Date()) {
  return Array.from({ length: count }, (_, i) => describe(
    new Date(from.getFullYear(), from.getMonth(), from.getDate() - (count - i)),
    { isPast: true },
  ));
}

// The interface is English, so the date is too (whatever the browser's language).
export const longLabel = (date) =>
  date.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });

export const rangeLabel = (days) => {
  const a = days[0], b = days[days.length - 1];
  return `${a.num} ${a.month} – ${b.num} ${b.month}`;
};
