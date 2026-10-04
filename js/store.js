// Picks the storage backend. Both expose the same API:
//
//   subscribe(onData, { from, to }, onError) -> unsubscribe
//       onData({ players, days, synced }) fires on every change.
//         players: { [id]: { id, name, avatar } }
//         days:    { [YYYY-MM-DD]: { players: [id], games: [{ id, name, year, by }] } }
//         synced:  false while the data may only be a local cache
//   addPlayer({ name, avatar })          -> id
//   updatePlayer(id, { name, avatar })
//   setAvailability(playerId, addDates, removeDates)
//   addGame(date, game) / removeGame(date, game)
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
