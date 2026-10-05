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

// How many available players it takes for a day to be "game on": the green marking,
// the "Game on" tag and the orange reminder banner.
export const MIN_PLAYERS = 3;

// How many available players it takes before people can add game ideas for a day.
// Lower than MIN_PLAYERS, so ideas can start early and others can join if they like
// what they see. (Only players who are available that day can vote.)
export const MIN_PLAYERS_FOR_IDEAS = 1;

// How many days the calendar shows, starting today.
export const DAYS_AHEAD = 14;

// How many days before today stay available in the "Last week" preview, so a game night that
// nobody logged on the day can still be logged.
export const DAYS_BEHIND = 7;

// Where game nights usually happen. "Add location & time" starts with it filled in; whoever adds the
// details can change it when the night is somewhere else.
export const DEFAULT_PLACE = 'BB-Spiele';

// The public address of the site. The WhatsApp messages the admin sends link to it.
export const SITE_URL = 'https://diegobrego.github.io/BoardGameNight/';
