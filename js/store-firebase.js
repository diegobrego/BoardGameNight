// SHARED backend: Cloud Firestore (free "Spark" plan is plenty for a friend group).
// Data layout:
//   players/{id}        { name, avatar, games?: [{ id, name, year }] }   (games: their favourites / owned list)
//   days/{YYYY-MM-DD}   { players: [playerId, ...], games: [{ id, name, year, by }, ...],
//                         votes:  { [voteKey]: [playerId, ...] },
//                         brings: { [voteKey]: [playerId, ...] },
//                         details: { place, time } }
//   plays/{id}          one entry in the hall of fame:
//                       { date, game: { id, name, year }, winner, players: [id], names: { id: name },
//                         loggedBy, note?, campaign? }   (campaign = the id of a campaigns/ document)
//   campaigns/{id}      a long game played over several sessions:
//                       { game, title, players: [id], names, status: 'active'|'finished', locked,
//                         startedAt, next, finishedAt, winner, createdBy }
//   admins/{uid}        created by hand in the Firebase console; makes that Google
//                       account an admin (see firestore.rules and the README)
// Availability and games use arrayUnion/arrayRemove, so two people saving at the
// same moment never overwrite each other.

import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js';
import {
  getAuth, onAuthStateChanged, signInWithPopup, GoogleAuthProvider, signOut as fbSignOut,
} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js';
import {
  getFirestore, collection, doc, onSnapshot, getDocs, addDoc, updateDoc, setDoc, deleteDoc, writeBatch,
  arrayUnion, arrayRemove, deleteField, query, where, orderBy, limit, documentId, serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js';
import { voteKey } from './games.js';
import { toPlain } from './admin.js';

export function create(config) {
  const app = initializeApp(config);
  const db = getFirestore(app);
  const auth = getAuth(app);
  const playersCol = collection(db, 'players');
  const daysCol = collection(db, 'days');
  const playsCol = collection(db, 'plays');
  const campaignsCol = collection(db, 'campaigns');

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
        snap.forEach((d) => {
          days[d.id] = { players: [], games: [], votes: {}, brings: {}, details: {}, ...d.data() };
        });
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

    // A player's list of favourite / owned games: [{ id, name, year }], saved as a whole.
    setPlayerGames: (id, games) => updateDoc(doc(playersCol, id), { games }),

    async setAvailability(playerId, add, remove) {
      const batch = writeBatch(db);
      for (const k of add) batch.set(doc(daysCol, k), { players: arrayUnion(playerId) }, { merge: true });
      for (const k of remove) batch.set(doc(daysCol, k), { players: arrayRemove(playerId) }, { merge: true });
      await batch.commit();
    },

    addGame: (date, game) => setDoc(doc(daysCol, date), { games: arrayUnion(game) }, { merge: true }),

    // `game` must be the object exactly as it came from a snapshot. Its votes and its
    // "I'll bring it"s go with it.
    removeGame: (date, game) => setDoc(
      doc(daysCol, date),
      {
        games: arrayRemove(game),
        votes: { [voteKey(game)]: deleteField() },
        brings: { [voteKey(game)]: deleteField() },
      },
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

    // Same shape as votes: who will bring each game to the game night.
    toggleBring: (date, key, playerId, on) => setDoc(
      doc(daysCol, date),
      { brings: { [key]: on ? arrayUnion(playerId) : arrayRemove(playerId) } },
      { merge: true },
    ),

    // The game night's location and start time ("19:30", or '' for none).
    setDetails: (date, { place, time }) => setDoc(
      doc(daysCol, date),
      { details: { place: place ?? '', time: time ?? '' } },
      { merge: true },
    ),

    // The hall of fame. Listening is separate from the calendar's data, so a problem
    // here (for example rules that haven't been updated yet) never breaks the calendar.
    subscribePlays(onData, onError) {
      const q = query(playsCol, orderBy('date', 'desc'), limit(500));
      return onSnapshot(q, (snap) => {
        onData(snap.docs.map((d) => {
          const v = d.data();
          return { id: d.id, ...v, createdAt: v.createdAt?.toMillis?.() ?? 0 };
        }));
      }, onError);
    },

    async logPlay(play) {
      const ref = await addDoc(playsCol, { ...play, createdAt: serverTimestamp() });
      return ref.id;
    },

    // Admin only (the rules enforce it). `patch` holds just the fields that change; one set to
    // `undefined` is removed from the entry (a cleared note, say).
    updatePlay: (id, patch) => updateDoc(doc(playsCol, id), Object.fromEntries(
      Object.entries(patch).map(([key, value]) => [key, value === undefined ? deleteField() : value]),
    )),

    // Admin only (the rules enforce it).
    deletePlay: (id) => deleteDoc(doc(playsCol, id)),

    // Everything the site stores, for the admin's backup download. (Reads are open, so this needs
    // no special permission; only the Admin page offers it.) Admin accounts are not included.
    async exportAll() {
      const read = async (col) => (await getDocs(col)).docs.map((d) => ({ id: d.id, ...toPlain(d.data()) }));
      const [players, days, plays, campaigns] = await Promise.all([read(playersCol), read(daysCol), read(playsCol), read(campaignsCol)]);
      const byId = (rows) => Object.fromEntries(rows.map(({ id, ...rest }) => [id, rest]));
      return { players: byId(players), days: byId(days), plays, campaigns };
    },

    // Campaigns: long games played over several sessions. A campaign's sessions are plays
    // (above) that carry the campaign's id. Like the hall of fame, this has its own listener.
    subscribeCampaigns(onData, onError) {
      return onSnapshot(campaignsCol, (snap) => {
        onData(snap.docs.map((d) => {
          const v = d.data();
          return { id: d.id, ...v, createdAt: v.createdAt?.toMillis?.() ?? 0 };
        }));
      }, onError);
    },

    async createCampaign(campaign) {
      const ref = await addDoc(campaignsCol, { ...campaign, createdAt: serverTimestamp() });
      return ref.id;
    },

    // Only the planned next date, the lock and the finish (status, date, winner) can be changed
    // this way; the people in it have their own two calls below.
    updateCampaign: (id, patch) => updateDoc(doc(campaignsCol, id), patch),

    // Joining and leaving use arrayUnion/arrayRemove, so two people joining at the same moment
    // never overwrite each other. `people` is [{ id, name }].
    addCampaignPlayers(id, people) {
      const patch = { players: arrayUnion(...people.map((p) => p.id)) };
      for (const p of people) patch[`names.${p.id}`] = p.name;
      return updateDoc(doc(campaignsCol, id), patch);
    },
    removeCampaignPlayer: (id, playerId) => updateDoc(doc(campaignsCol, id), {
      players: arrayRemove(playerId),
      [`names.${playerId}`]: deleteField(),
    }),

    // The site offers this to the campaign's creator and to admins (the sessions stay).
    deleteCampaign: (id) => deleteDoc(doc(campaignsCol, id)),

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
