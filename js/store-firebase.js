// SHARED backend: Cloud Firestore (free "Spark" plan is plenty for a friend group).
// Data layout:
//   players/{id}        { name, avatar }
//   days/{YYYY-MM-DD}   { players: [playerId, ...], games: [{ id, name, year, by }, ...],
//                         votes: { [voteKey]: [playerId, ...] } }
//   admins/{uid}        created by hand in the Firebase console; makes that Google
//                       account an admin (see firestore.rules and the README)
// Availability and games use arrayUnion/arrayRemove, so two people saving at the
// same moment never overwrite each other.

import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js';
import {
  getAuth, onAuthStateChanged, signInWithPopup, GoogleAuthProvider, signOut as fbSignOut,
} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js';
import {
  getFirestore, collection, doc, onSnapshot, getDocs, addDoc, updateDoc, setDoc, writeBatch,
  arrayUnion, arrayRemove, deleteField, query, where, documentId, serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js';
import { voteKey } from './games.js';

export function create(config) {
  const app = initializeApp(config);
  const db = getFirestore(app);
  const auth = getAuth(app);
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
        snap.forEach((d) => { days[d.id] = { players: [], games: [], votes: {}, ...d.data() }; });
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

    // `game` must be the object exactly as it came from a snapshot. Its votes go with it.
    removeGame: (date, game) => setDoc(
      doc(daysCol, date),
      { games: arrayRemove(game), votes: { [voteKey(game)]: deleteField() } },
      { merge: true },
    ),

    // votes: { [voteKey]: [playerId, ...] } on the day document. One entry per player
    // per game, and arrayUnion/arrayRemove keep simultaneous voters from clobbering
    // each other. (Votes left behind by a removed player are ignored when displayed.)
    toggleVote: (date, key, playerId, on) => setDoc(
      doc(daysCol, date),
      { votes: { [key]: on ? arrayUnion(playerId) : arrayRemove(playerId) } },
      { merge: true },
    ),

    // Admin only (the rules enforce it). Finds every day the player ever picked, not
    // just the visible two weeks. A batch holds at most 500 writes, so a very long
    // history is split up; the player's own document goes in the first batch.
    async deletePlayer(id) {
      const picked = await getDocs(query(daysCol, where('players', 'array-contains', id)));
      const refs = picked.docs.map((d) => d.ref);
      const chunks = [];
      for (let i = 0; i < refs.length; i += 400) chunks.push(refs.slice(i, i + 400));
      if (!chunks.length) chunks.push([]);

      for (const [i, chunk] of chunks.entries()) {
        const batch = writeBatch(db);
        if (i === 0) batch.delete(doc(playersCol, id));
        for (const ref of chunk) batch.set(ref, { players: arrayRemove(id) }, { merge: true });
        await batch.commit();
      }
    },

    // Reports who is signed in (with Google) and whether that account is an admin.
    // `checking` is true for the moment between signing in and learning the answer.
    subscribeAdmin(fn) {
      const emit = (state) => fn({
        canSignIn: true, signedIn: false, checking: false, isAdmin: false, uid: null, ...state,
      });
      let offAdminDoc = null;
      const offAuth = onAuthStateChanged(auth, (user) => {
        offAdminDoc?.();
        offAdminDoc = null;
        if (!user) { emit({}); return; }
        emit({ signedIn: true, checking: true, uid: user.uid });
        offAdminDoc = onSnapshot(
          doc(db, 'admins', user.uid),
          (snap) => emit({ signedIn: true, isAdmin: snap.exists(), uid: user.uid }),
          () => emit({ signedIn: true, isAdmin: false, uid: user.uid }),
        );
      });
      return () => { offAuth(); offAdminDoc?.(); };
    },

    signIn: () => signInWithPopup(auth, new GoogleAuthProvider()),
    signOut: () => fbSignOut(auth),
  };
}
