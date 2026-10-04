const DOW = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const MONTH = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

const pad = (n) => String(n).padStart(2, '0');

// Local calendar date -> "2026-10-04". Never goes through UTC, so it can't shift a day.
export const dateKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export function upcomingDays(count, from = new Date()) {
  const start = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  return Array.from({ length: count }, (_, i) => {
    const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    return {
      key: dateKey(date),
      date,
      dow: DOW[date.getDay()],
      num: date.getDate(),
      month: MONTH[date.getMonth()],
      isToday: i === 0,
      isWeekend: date.getDay() === 0 || date.getDay() === 6,
    };
  });
}

// The interface is English, so the date is too (whatever the browser's language).
export const longLabel = (date) =>
  date.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });

export const rangeLabel = (days) => {
  const a = days[0], b = days[days.length - 1];
  return `${a.num} ${a.month} – ${b.num} ${b.month}`;
};
