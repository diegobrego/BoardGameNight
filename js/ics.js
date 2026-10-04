// Builds an iCalendar (.ics) file for a game night, for the "Add to calendar" button.
// It only builds text, so it can be tested on its own.

const pad = (n) => String(n).padStart(2, '0');
const dayStamp = (d) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
const localStamp = (d) => `${dayStamp(d)}T${pad(d.getHours())}${pad(d.getMinutes())}00`;
const utcStamp = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

// Commas, semicolons, backslashes and line breaks are special in iCalendar text.
const escapeText = (s) => String(s)
  .replace(/\\/g, '\\\\')
  .replace(/;/g, '\\;')
  .replace(/,/g, '\\,')
  .replace(/\r?\n/g, '\\n');

// A line may be at most 75 bytes; longer ones continue on the next line, indented by a space.
const encoder = new TextEncoder();
function fold(line) {
  const parts = [];
  let current = '';
  let bytes = 0;
  for (const ch of line) {
    const size = encoder.encode(ch).length;
    if (bytes + size > 75) {
      parts.push(current);
      current = ' ';
      bytes = 1;
    }
    current += ch;
    bytes += size;
  }
  parts.push(current);
  return parts.join('\r\n');
}

// key: "2026-10-09", date: that day as a Date, time: "19:30" or '' (then it's an all-day event).
// Times are "floating": they mean 19:30 wherever the person's calendar happens to be, which
// is what you want for a group that meets in one place.
export function buildIcs({
  key, date, place = '', time = '', summary = 'Game night', description = '', url = '',
  hours = 3, now = new Date(),
}) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Board Game Night//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${key}@board-game-night`,
    `DTSTAMP:${utcStamp(now)}`,
  ];

  const clock = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time);
  if (clock) {
    const start = new Date(date.getFullYear(), date.getMonth(), date.getDate(), Number(clock[1]), Number(clock[2]));
    const end = new Date(start.getTime() + hours * 3600000);
    lines.push(`DTSTART:${localStamp(start)}`, `DTEND:${localStamp(end)}`);
  } else {
    const next = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1);
    lines.push(`DTSTART;VALUE=DATE:${dayStamp(date)}`, `DTEND;VALUE=DATE:${dayStamp(next)}`);
  }

  lines.push(`SUMMARY:${escapeText(summary)}`);
  if (place) lines.push(`LOCATION:${escapeText(place)}`);
  if (description) lines.push(`DESCRIPTION:${escapeText(description)}`);
  if (url) lines.push(`URL:${url}`);
  lines.push('END:VEVENT', 'END:VCALENDAR');

  return `${lines.map(fold).join('\r\n')}\r\n`;
}
