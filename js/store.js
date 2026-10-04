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

import { firebaseConfig } from './config.js';

export async function createStore() {
  const backend = firebaseConfig ? await import('./store-firebase.js') : await import('./store-local.js');
  return backend.create(firebaseConfig);
}
