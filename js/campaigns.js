// Helpers for campaigns: long games played over several sessions on different days (Arcs,
// Oath, Pandemic Legacy...). It only reshapes data, so it can be tested on its own.
//
// A campaign is { id, title, game, players, names, status: 'active' | 'finished', locked,
// startedAt, next, finishedAt, winner, createdBy }. Its sessions are not stored on it: they are
// ordinary logged plays (the hall of fame entries) that carry the campaign's id, so a session
// also counts as a game night.
//
// Who can do what: anyone can join a running campaign until its creator locks it; after that
// only the creator adds people. Anyone in the campaign can log a session and plan the next one.
// Only the creator can lock it and finish it. (The site enforces this; the database can't tell
// who is who, because players have no passwords. Admins count as the creator, see `can`.)

export const defaultTitle = (game) => `${game.name} campaign`;

// A campaign's sessions, oldest first.
export const sessionsOf = (plays, campaignId) => plays
  .filter((p) => p.campaign === campaignId)
  .sort((a, b) => a.date.localeCompare(b.date) || (a.createdAt ?? 0) - (b.createdAt ?? 0));

// Active campaigns that have a session planned on this day.
export const plannedOn = (campaigns, key) => campaigns.filter((c) => c.status === 'active' && c.next === key);

// How many campaigns a player has been in, and how many they won.
export const campaignRecord = (campaigns, playerId) => ({
  played: campaigns.filter((c) => c.players?.includes(playerId)).length,
  won: campaigns.filter((c) => c.status === 'finished' && c.winner === playerId).length,
});

export const isRunning = (c) => c.status !== 'finished';
export const isMember = (c, playerId) => !!playerId && !!c.players?.includes(playerId);
export const isCreator = (c, playerId) => !!playerId && c.createdBy === playerId;

// What a player may do with a campaign. `admin` is a signed-in admin: they can run any campaign
// (lock it, add people, finish it, reopen it, remove it), which also rescues one whose creator
// has since left. A finished campaign is closed to everyone except that: only the creator can
// reopen it. Only the creator can remove a campaign, running or finished.
export function can(c, playerId, { admin = false } = {}) {
  const running = isRunning(c);
  const member = isMember(c, playerId);
  const creator = isCreator(c, playerId) || admin;
  return {
    join: running && !c.locked && !!playerId && !member,
    leave: running && !c.locked && member && !isCreator(c, playerId),
    log: running && member,       // log a session, and say when the next one is
    plan: running && member,
    manage: running && creator,   // lock or unlock it, add people, finish it
    reopen: !running && creator,  // take a finished campaign back to the running list
    remove: creator,              // delete it (its sessions stay in the hall of fame)
  };
}

// Players who could still be added to a campaign.
export const outsiders = (c, players) => players.filter((p) => !c.players?.includes(p.id));

// Active ones first (most recently started first), then finished ones (most recently finished first).
export function sortCampaigns(campaigns) {
  const active = campaigns.filter((c) => c.status !== 'finished')
    .sort((a, b) => (b.startedAt ?? '').localeCompare(a.startedAt ?? '') || (b.createdAt ?? 0) - (a.createdAt ?? 0));
  const finished = campaigns.filter((c) => c.status === 'finished')
    .sort((a, b) => (b.finishedAt ?? '').localeCompare(a.finishedAt ?? ''));
  return { active, finished };
}
