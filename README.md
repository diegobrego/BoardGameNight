# Board Game Night

A tiny website for a board game group. Everyone picks the days they're available over the next two weeks, days with 3+ available players light up green as a game night, and anyone can already float game ideas (with links to BoardGameGeek) once a single person is available.

Plain HTML/CSS/JS, no build step, hosted for free on GitHub Pages. Look: a Playdate feel (dither patterns, hard shadows, pixel-art player faces) in purple, with a rounded easy-to-read font and crisp vector icons. There's a **light and a dark theme**: it follows the device by default, and the sun/moon button in the header switches it (and remembers the choice). Green is reserved for "game on" days.

## Try it on your computer

```bash
node tools/serve.mjs
```

Open <http://localhost:8080>. Until you connect a database (below) the site runs in **demo mode**: a few fake players, and everything is saved only in your own browser. Even after you've connected one, adding **`?demo`** to the address (e.g. `http://localhost:8080/?demo`) gives you that private demo copy to try things out without touching the real data.

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

### 3. Become the admin (to remove players)

Removing a player needs real proof of who you are, and a password hidden in a web page isn't proof (anyone can read the page's code). So the admin signs in with Google, and the database rules only let signed-in admins delete players. One-time setup:

1. Firebase console → **Build → Authentication → Get started → Sign-in method → Google → Enable.** Pick your email as the support email and **Save**.
2. **Authentication → Settings → Authorized domains → Add domain**, and add the domain the site lives on (`<your-username>.github.io`). `localhost` is already allowed.
3. Publish the updated [`firestore.rules`](firestore.rules) again (Firestore Database → **Rules** → paste → **Publish**).
4. Open the site, click **Admin sign-in** in the footer and sign in with Google. A dialog shows your user ID.
5. In the Firebase console go to **Firestore Database → Data → Start collection**, name it `admins`, set the **Document ID** to your user ID, add any field (for example `note` = `owner`) and save. The site switches to admin mode by itself.

In admin mode you get an **Admin** tag and an **X** next to everyone in "The crew". Removing someone takes them out of the crew **and off every day they picked**. Their game suggestions stay on the list (an admin can remove any game). To add another admin, add their user ID as another document in `admins`. Your email is never stored in the code or the repository.

## How people use it

- **First visit:** pick your name from the list, or add yourself (type a name, choose a pixel face). Your device remembers you; tap your name in the top corner to edit your profile or switch player.
- **Pick my days:** tap every day you can play, then **Save**. Green days update live as you tick them.
- **Game ideas:** tap any day with at least one available player (`MIN_PLAYERS_FOR_IDEAS`) to see who's in and add game ideas with the **+** button. Games link to their BoardGameGeek page. Posting an idea early lets others decide to join if they like it. The **?** next to "Game options" explains how game nights work.
- **Green days** (3+ available players, set by `MIN_PLAYERS`) are marked with a green double border and a **Game on** tag: that's a game night.
- **Reminder banner:** when today or tomorrow is a game night, an orange banner at the top of the site says so for everyone.
- **WhatsApp (admin only):** the signed-in admin sees a **Remind the group** button on that banner, and a **Remind the group** / **Tell the group** button on a game night's day panel. It opens WhatsApp with a ready-made message (who's in, the top-voted game, and a link to the site); the admin picks the group and taps send. Nothing is sent automatically, and WhatsApp doesn't allow a website to post into an existing group by itself. Keeping the buttons admin-only just keeps them off everyone else's screen, since anyone could write the same message by hand.

- **Voting:** every game on a day has an up-arrow button. Tap it for each game you'd be happy to play (tap again to take the vote back; you can vote for several). Only players who are available that day can vote, and a vote only counts while its voter is still available. The list sorts by votes, shows who voted, and the leader gets a **Top pick** tag. Removing a game removes its votes.

## Things to know

- **When the rules change, re-publish them.** Some updates change [`firestore.rules`](firestore.rules). The voting update did: it lets days store `votes`. After pulling such an update, paste the file into Firebase console → Firestore Database → **Rules** and **Publish**, or the new feature will fail to save.
- **No passwords for players.** Tapping a name in "Who are you?" makes that device that person, and from then on it can change that person's days and profile (name and face) for everyone. The site asks "Are you …?" first, but that's a speed bump, not a lock. It's the trade-off for zero sign-up: fine for friends, but don't put anything private in it. Only the admin is verified (Google sign-in), and only for removing players. A real lock would mean player accounts (for example Google sign-in per player).
- **If someone ends up as you by mistake:** they tap their name at the top → **Edit profile** → **Switch player** → **I'm new here**. Then you change your own name and face back the same way.
- **Game search is local.** BoardGameGeek's API now requires a private token and blocks browser requests, so the site ships with a compact index of ~14,000 BGG games ([`data/games.json`](data/games.json), built from a public daily ranking dump). A game that isn't in the index can still be added by name (its link opens a BGG search), or by pasting its BGG link. To refresh the index: `node tools/update-games.mjs`.
- **Removing people:** the admin does it from the site (see above). Old days can be tidied in the Firebase console (Firestore Database → `days`).

## Customising

| What | Where |
| --- | --- |
| Players needed for a "game on" day, players needed before ideas can be added, number of days shown | [`js/config.js`](js/config.js) (`MIN_PLAYERS`, `MIN_PLAYERS_FOR_IDEAS`, `DAYS_AHEAD`) |
| The site address used in WhatsApp messages | [`js/config.js`](js/config.js) (`SITE_URL`) |
| The colours: one palette per theme (`--solid` is the purple, `--go` the green) | the two token blocks at the top of [`css/style.css`](css/style.css) (`:root` is light, `:root[data-theme="dark"]` is dark) |
| The font (currently [M PLUS Rounded 1c](https://fonts.google.com/specimen/M+PLUS+Rounded+1c)) | `--font` in [`css/style.css`](css/style.css) and the Google Fonts `<link>` in [`index.html`](index.html) |

## Files

```
index.html            page shell
css/style.css         the 1-bit look
js/app.js             all the UI
js/store-firebase.js  shared backend (Firestore)
js/store-local.js     demo backend (this browser only)
js/games.js           game search + BGG links
js/avatar.js          pixel faces
js/icons.js           vector icons
data/games.json       BGG game index
tools/                local server, game-index builder
firestore.rules       database rules to paste into Firebase
```

Data from [BoardGameGeek](https://boardgamegeek.com). This project is not affiliated with BGG.
