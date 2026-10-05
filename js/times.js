// Start times: the time a player can start from on a day ("I can be there from 19:30"). They are kept on the
// day, as times: { [playerId]: 'HH:MM' }. A player with no time there (days picked before start times
// existed, say) can start from DEFAULT_START. The game night's own start time (the day's details) is separate:
// it is what the group agreed on, and by default it is the latest time anyone named. These helpers only reshape
// data, so they can be tested alone.

const TIME_RE = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;
export const isTime = (value) => typeof value === 'string' && TIME_RE.test(value);

export const DEFAULT_START = '17:00';

// Each of the given players with the time they can start from: [{ id, time }]. (A missing time, one that is
// not a time, or one kept for someone who is no longer on the day, gives DEFAULT_START or is ignored.)
export const startTimesOf = (times, ids) => ids.map((id) => ({ id, time: isTime(times?.[id]) ? times[id] : DEFAULT_START }));

// When everyone on the day can be there: the latest of their times, and who has it. `{ time: '', ids: [] }`
// for a day nobody is on. Times are zero-padded, so text order is time order.
export function latestStart(times, ids) {
  const all = startTimesOf(times, ids);
  if (!all.length) return { time: '', ids: [] };
  const time = all.reduce((latest, t) => (t.time > latest ? t.time : latest), '');
  return { time, ids: all.filter((t) => t.time === time).map((t) => t.id) };
}
