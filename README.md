# Board Game Night

A tiny website for a board game group. Everyone picks the days they're free over the next two weeks, days with 3+ free players light up green, and on those days the group can pile up game options with links to BoardGameGeek.

Plain HTML/CSS/JS, no build step, hosted for free on GitHub Pages. Look: 1-bit Playdate style, black and white, with green as the one signal colour.

## Try it on your computer

```bash
node tools/serve.mjs
```

Open <http://localhost:8080>. Until you connect a database (below) the site runs in **demo mode**: a few fake players, and everything is saved only in your own browser.

## Put it online for the group

GitHub Pages can only serve files, so the shared calendar needs somewhere to keep its data. This project uses **Firebase Firestore** (free plan, no server to run, no credit card). Do step 1 once, then step 2.

### 1. Connect the shared database

1. Go to <https://console.firebase.google.com> and **Add project** (turn Google Analytics off).
2. **Build → Firestore Database → Create database.** Pick a nearby location, start in **production mode**.
3. Open the **Rules** tab, paste in the contents of [`firestore.rules`](firestore.rules), and **Publish**.
4. Click the gear → **Project settings → General → Your apps → `</>` (Web)**. Register the app (skip Firebase Hosting) and copy the `firebaseConfig` object it shows you.
5. In [`js/config.js`](js/config.js), replace `export const firebaseConfig = null;` with your config:

   ```js
   export const firebaseConfig = {
     apiKey: "…",
     authDomain: "…",
     projectId: "…",
     storageBucket: "…",
     messagingSenderId: "…",
     appId: "…",
   };
   ```

   These values are not secrets; they identify your project and are meant to be public. The rules in step 3 are what protect the data.

Reload the site and the demo banner is gone: you're talking to the real database.

### 2. Publish on GitHub Pages

1. Create a new repository on GitHub and push this folder to it.
2. In the repo: **Settings → Pages → Build and deployment → Deploy from a branch → `main` / `(root)` → Save.**
3. After a minute the site is live at `https://<your-username>.github.io/<repo-name>/`. Drop that link in the WhatsApp group.

## How people use it

- **First visit:** pick your name from the list, or add yourself (type a name, choose a pixel face). Your device remembers you; tap your name in the top corner to edit your profile or switch player.
- **Pick my days:** tap every day you can play, then **Save**. Green days update live as you tick them.
- **Green days** (3+ free players) are marked with a green double border and a **Game on** tag. Tap one to see who's in and to add game options with the **+** button. Games link to their BoardGameGeek page.

## Things to know

- **No passwords.** Anyone with the link can use any name. That's the trade-off for zero sign-up; it's fine for friends, but don't put anything private in it. If it ever gets abused, the next step would be a shared group code or Firebase Authentication.
- **Game search is local.** BoardGameGeek's API now requires a private token and blocks browser requests, so the site ships with a compact index of ~14,000 BGG games ([`data/games.json`](data/games.json), built from a public daily ranking dump). A game that isn't in the index can still be added by name (its link opens a BGG search), or by pasting its BGG link. To refresh the index: `node tools/update-games.mjs`.
- **Removing people or old data:** do it in the Firebase console (Firestore Database → `players` / `days`). The app can't delete players.

## Customising

| What | Where |
| --- | --- |
| Players needed for a "game on" day, number of days shown | [`js/config.js`](js/config.js) (`MIN_PLAYERS`, `DAYS_AHEAD`) |
| The green (set `--go` to `#000` for pure black and white) | top of [`css/style.css`](css/style.css) |

## Files

```
index.html            page shell
css/style.css         the 1-bit look
js/app.js             all the UI
js/store-firebase.js  shared backend (Firestore)
js/store-local.js     demo backend (this browser only)
js/games.js           game search + BGG links
js/avatar.js          pixel faces
data/games.json       BGG game index
tools/                local server, game-index builder
firestore.rules       database rules to paste into Firebase
```

Data from [BoardGameGeek](https://boardgamegeek.com). This project is not affiliated with BGG.
