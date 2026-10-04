// Picks the storage backend. Both expose the same API:
//
//   subscribe(onData, { from, to }, onError) -> unsubscribe
//       onData({ players, days, synced }) fires on every change.
//         players: { [id]: { id, name, avatar, games?: [{ id, name, year }] } }
//         days:    { [YYYY-MM-DD]: { players: [id], games: [{ id, name, year, by }] } }
//         synced:  false while the data may only be a local cache
//   addPlayer({ name, avatar })          -> id
//   updatePlayer(id, { name, avatar })
//   setPlayerGames(id, [{ id, name, year }])    the player's favourite / owned games, saved as a whole
//   setAvailability(playerId, addDates, removeDates)
//   addGame(date, game) / removeGame(date, game)   (removing a game also drops its votes)
//   toggleVote(date, voteKey, playerId, on)         days[date].votes: { [voteKey]: [playerId] }
//   toggleBring(date, voteKey, playerId, on)        days[date].brings: { [voteKey]: [playerId] }
//   setDetails(date, { place, time })               days[date].details
//
// Hall of fame (one entry per game played):
//   subscribePlays(onData(plays[]), onError) -> unsubscribe
//       play: { id, date, game: { id, name, year }, winner: id|null,
//               players: [id], names: { [id]: name }, loggedBy, createdAt }
//   logPlay(play) -> id        updatePlay(id, patch)    deletePlay(id)   (the last two: admin only)
//       (in a patch, a field set to undefined is removed)
//       a play may also carry  note  and  campaign (a campaign id: it is a session of that campaign)
//   exportAll() -> { players, days, plays, campaigns, sharedGames }   for the admin's backup download
//   restoreAll(ops, onProgress)   admin: write a backup back, ops from restoreOps() in admin.js
//   listDayKeys() -> [date]       deleteDays([date])     admin: tidying old days
//
// Campaigns (long games over several sessions, e.g. Arcs or Oath):
//   subscribeCampaigns(onData(campaigns[]), onError) -> unsubscribe
//       campaign: { id, title, game, players: [id], names, status: 'active'|'finished', locked,
//                   startedAt, next, finishedAt, winner, createdBy, createdAt }
//   createCampaign(campaign) -> id    updateCampaign(id, patch)    deleteCampaign(id)
//   addCampaignPlayers(id, [{ id, name }])    removeCampaignPlayer(id, playerId)
//       a campaign may also carry  notes  (text kept by the people in it)
//
// The group's collection (players' collections + games played though nobody had them):
//   subscribeSharedGames(onData(games[]), onError) -> unsubscribe     games: { key, gameId, name, year, source }
//   addSharedGame({ id, name, year })      removeSharedGame(key, [{ playerId, games }])   (the last: admin only)
//
// Feedback ("Send feedback" link; only admins read it):
//   sendFeedback({ message, name, by })    subscribeFeedback(onData(rows[]), onError) -> unsubscribe
//   markFeedback(id, seen)    deleteFeedback(id)
//
// Admin tools:
//   deletePlayer(id)                     removes the player and takes them off every day
//   subscribeAdmin(fn) -> unsubscribe    fn({ canSignIn, signedIn, checking, isAdmin, uid })
//   signIn() / signOut()                 admin sign-in (shared backend only)

import { firebaseConfig } from './config.js';

// Adding ?demo to the address runs the site on a private, local-only copy: handy
// for trying things out without touching the shared database.
export const isForcedDemo = new URLSearchParams(location.search).has('demo');

export async function createStore() {
  const shared = firebaseConfig && !isForcedDemo;
  const backend = shared ? await import('./store-firebase.js') : await import('./store-local.js');
  return backend.create(firebaseConfig);
}
