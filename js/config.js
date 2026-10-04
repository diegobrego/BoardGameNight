// ---------------------------------------------------------------------------
// Settings. Everything you might want to tweak lives here.
// ---------------------------------------------------------------------------

// Firebase web-app config: this is what shares data between everyone.
// These values are public identifiers, not secrets; the Firestore rules
// (firestore.rules) are what protect the data.
// Set it to `null` to go back to DEMO mode (data stays in your own browser).
export const firebaseConfig = {
  apiKey: "AIzaSyAf90qxyxZ-cp4yhYnIenkdcGu-DHWBgNo",
  authDomain: "board-game-night-bf98c.firebaseapp.com",
  projectId: "board-game-night-bf98c",
  storageBucket: "board-game-night-bf98c.firebasestorage.app",
  messagingSenderId: "85012025970",
  appId: "1:85012025970:web:e0f5d1c1818607402728eb",
};

// How many free players it takes for a day to light up (and unlock game options).
export const MIN_PLAYERS = 3;

// How many days the calendar shows, starting today.
export const DAYS_AHEAD = 14;
