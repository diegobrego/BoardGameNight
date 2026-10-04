// SHARED backend: Cloud Firestore (free "Spark" plan is plenty for a friend group).
// Data layout:
//   players/{id}        { name, avatar }
//   days/{YYYY-MM-DD}   { players: [playerId, ...], games: [{ id, name, year, by }, ...] }
// Availability and games use arrayUnion/arrayRemove, so two people saving at the
// same moment never overwrite each other.

import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js';
import {
  getFirestore, collection, doc, onSnapshot, addDoc, updateDoc, setDoc, writeBatch,
  arrayUnion, arrayRemove, query, where, documentId, serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js';

export function create(config) {
  const db = getFirestore(initializeApp(config));
  const playersCol = collection(db, 'players');
  const daysCol = collection(db, 'days');

  return {
    mode: 'firebase',

    subscribe(onData, { from, to }, onError) {
      let players = null, days = null;
      let playersSynced = false, daysSynced = false;
      const emit = () => {
        if (players && days) onData({ players, days, synced: playersSynced && daysSynced });
      };

      const offPlayers = onSnapshot(playersCol, (snap) => {
        players = {};
        snap.forEach((d) => { players[d.id] = { id: d.id, ...d.data() }; });
        playersSynced = !snap.metadata.fromCache;
        emit();
      }, onError);

      // Day ids are ISO dates, so a string range selects exactly the visible window.
      const range = query(daysCol, where(documentId(), '>=', from), where(documentId(), '<=', to));
      const offDays = onSnapshot(range, (snap) => {
        days = {};
        snap.forEach((d) => { days[d.id] = { players: [], games: [], ...d.data() }; });
        daysSynced = !snap.metadata.fromCache;
        emit();
      }, onError);

      return () => { offPlayers(); offDays(); };
    },

    async addPlayer({ name, avatar }) {
      const ref = await addDoc(playersCol, { name, avatar, createdAt: serverTimestamp() });
      return ref.id;
    },

    updatePlayer: (id, patch) => updateDoc(doc(playersCol, id), patch),

    async setAvailability(playerId, add, remove) {
      const batch = writeBatch(db);
      for (const k of add) batch.set(doc(daysCol, k), { players: arrayUnion(playerId) }, { merge: true });
      for (const k of remove) batch.set(doc(daysCol, k), { players: arrayRemove(playerId) }, { merge: true });
      await batch.commit();
    },

    addGame: (date, game) => setDoc(doc(daysCol, date), { games: arrayUnion(game) }, { merge: true }),

    // `game` must be the object exactly as it came from a snapshot.
    removeGame: (date, game) => setDoc(doc(daysCol, date), { games: arrayRemove(game) }, { merge: true }),
  };
}
