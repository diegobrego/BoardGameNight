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

### 3. Become the admin (the Admin page, and removing players)

Removing a player needs real proof of who you are, and a password hidden in a web page isn't proof (anyone can read the page's code). So the admin signs in with Google, and the database rules only let signed-in admins delete players. One-time setup:

1. Firebase console → **Build → Authentication → Get started → Sign-in method → Google → Enable.** Pick your email as the support email and **Save**.
2. **Authentication → Settings → Authorized domains → Add domain**, and add the domain the site lives on (`<your-username>.github.io`). `localhost` is already allowed.
3. Publish the updated [`firestore.rules`](firestore.rules) again (Firestore Database → **Rules** → paste → **Publish**).
4. Open the site, click **Admin sign-in** in the footer and sign in with Google. A dialog shows your user ID.
5. In the Firebase console go to **Firestore Database → Data → Start collection**, name it `admins`, set the **Document ID** to your user ID, add any field (for example `note` = `owner`) and save. The site switches to admin mode by itself.

In admin mode you get an **Admin** tag and an **Admin** tab. Players are removed from the Admin tab (below): tap a player there, then **Remove**. Removing someone takes them out of the group **and off every day they picked** (their entries in the hall of fame stay, under the name they had). Admins can also remove entries from the hall of fame, and remove any campaign (a campaign's creator can remove their own too; its sessions stay in the hall of fame). Their game suggestions stay on the list (an admin can remove any game). To add another admin, add their user ID as another document in `admins`. Your email is never stored in the code or the repository.

**The Admin page.** Once you're an admin, an **Admin** tab appears next to the others. Nobody else sees it: the tab is hidden, opening its address just shows the calendar, and the database only lets an admin edit or remove the things below. It has these parts:

- **Players:** everyone in the group. Tap a player to open their details (coming days picked, games in their collection, campaigns, logged games and wins); the **Remove** button is in there, so nobody is removed by a stray tap, and it asks to confirm. Only one player is open at a time; tap again to close.
- **Campaigns and upcoming games:** every campaign (running and finished), with **See** and **Remove**, and every game suggested for the next two weeks, with an X to take one off a day.
- **Hall of fame:** every logged game, with **Edit** (change the date, game, who played, the winner, its campaign or its note) and **Remove**, plus **Add an entry** for a game night nobody logged, on any past date.
- **Game collection:** every game anyone has in their collection, plus games that were played although nobody had them listed (see "The group's collection" below). Games nobody listed come first. Tap one to see who has it, and **Remove from the collection** to take it out of the group's collection, which also takes it off the lists of the players who had it.
- **Feedback:** the messages people sent with **Send feedback** at the bottom of the site, newest first, with who sent them and when. New ones are marked, and the Admin tab shows how many are new. **Mark read** or **Delete** each one.
- **Tidy old days:** every day anyone picked or suggested a game for stays in the database for good. **Check old days** counts them, then buttons remove the ones older than a month, three months, six months or a year (each says how many). That removes only those days' availability, votes and game ideas; logged games, campaigns and players are never touched. Each removal asks to confirm.
- **Backup and restore:** **Download backup** saves one JSON file with the players (and their collections), every day, the hall of fame, the campaigns and the shared games. Admin accounts and feedback aren't in it. **Restore** takes such a file: it checks the file and shows what's in it first, and only writes when you confirm. A restore adds everything back and overwrites entries with the same name (a player, a day, a logged game, a campaign); it never deletes anything.

New admins are still added by hand, exactly as in the steps above (a document in the `admins` collection); the Admin page doesn't manage admin accounts.

## How people use it

- **Help page:** the **?** button at the top of every page (and **How it works** at the bottom) opens a short, illustrated guide, [`help.html`](help.html): getting started, joining a game night, building your game collection and starring favourites, adding a game to a day, starting or joining a campaign, and logging what you played. It is a normal page, so you can send its link (`…/help.html`) to someone new. Add `?demo` to the site address to practise on a private copy.
- **Players tab:** everyone in the group, in a list: how many games they've played, won and which nights, how many games are in their collection (with their favourites), how many campaigns, and any titles. With more than eight players a search box appears. Tap a row for the full player card.
- **The group's collection, and the orange "!":** the group's collection is every game anyone has in their own collection, plus games that were played although nobody had them listed ("someone has to own it to be able to play": logging such a game adds it automatically). Nothing is stored twice, so when a player takes a game off their list it leaves the group's collection too, unless someone else has it. A game on a day's list (or a campaign) that nobody has gets a small orange **!** next to its name; tap it for the explanation.
- **Campaign notes:** every campaign has a **Notes** section (closed by default, with the first line as a preview) for things like where you left off, house rules or who plays which faction. Anyone in a running campaign can **Add notes** or **Edit notes** (up to 2000 characters); once it's finished the notes stay readable. (Reopen a campaign to edit them again.)
- **Send feedback:** the **Send feedback** link at the bottom of every page opens a small form (a message, and optionally your name). Only an admin can read what's sent, on the Admin page.
- **First visit:** pick your name from the list, or add yourself (type a name, choose a pixel face). Your device remembers you; tap your name in the top corner to edit your profile or switch player.
- **Pick my days:** tap every day you can play, then **Save**. Green days update live as you tick them.
- **Game ideas:** tap any day with at least one available player (`MIN_PLAYERS_FOR_IDEAS`) to see who's in and add game ideas with the **+** button. Games link to their BoardGameGeek page. Posting an idea early lets others decide to join if they like it. The **?** next to "Game options" explains how game nights work.
- **Game options fold:** in a day's panel, **Game options** can be collapsed. Closed, it still shows the most-voted game, with a note about how many more there are; open, it lists them all with the most votes first. A list of up to 3 games starts open, a longer one starts closed, your choice is remembered on that device, and adding a game opens it so you see it. When a vote changes the order, the games glide to their new places instead of jumping, and a game you add fades in. (Nothing moves if your device is set to reduce motion.)
- **Green days** (3+ available players, set by `MIN_PLAYERS`) are marked with a green double border and a **Game on** tag: that's a game night.
- **Reminder banners:** on the calendar page, when today or tomorrow is a game night, a slim orange banner at the top says so for everyone: when, the game that's winning the vote, and a **See the game night** link that opens the day. If you're in a campaign whose next session is planned for today or tomorrow, you get a **Campaign today/tomorrow** banner too, with the campaign's name and session number and a **See the campaign** link that jumps to it on the Campaigns page. Only the people in that campaign see the campaign banner.
- **WhatsApp (admin only):** the signed-in admin sees a **Remind the group** button on that banner, and a **Remind the group** / **Tell the group** button on a game night's day panel. It opens WhatsApp with a ready-made message (who's in, the top-voted game, and a link to the site); the admin picks the group and taps send. Nothing is sent automatically, and WhatsApp doesn't allow a website to post into an existing group by itself. Keeping the buttons admin-only just keeps them off everyone else's screen, since anyone could write the same message by hand.

- **Voting:** every game on a day has an up-arrow button. Tap it for each game you'd be happy to play (tap again to take the vote back; you can vote for several). Only players who are available that day can vote, and a vote only counts while its voter is still available. The list sorts by votes, shows who voted, and the leader gets a star badge (the top pick). Removing a game removes its votes.
- **My collection:** in your profile (tap your name at the top), **Manage my collection** keeps a list of the games you own or love (up to 60; search to add, X to remove). Tap the star on a game to mark it as a favourite; favourites come first. When you tap **Add a game** on a day, the search stays as it is, and the **Add game from collection** button under it opens your whole collection: tap a game to put it on the day (games already there are greyed out), star or unstar games right in that list, and use the filter box once the list gets long. So the games you always bring are one tap away instead of a search. Your collection is saved on your profile in the shared database.
- **"I'll bring it":** each game idea has a button to say you'll bring that game to the game night ("Brought by Mia"). Like voting, it's for players who are available that day, and it only counts while they are. The button names who is bringing the game ("Mia is bringing it"): filled when you're one of them, tinted when only others are, and tapping it adds or removes you.
- **Where and when:** on a game night's day panel, an available player can **Add location & time**. It shows in the panel, in the orange banner and in the WhatsApp message.
- **Add to calendar:** a game night's day panel has an **Add to calendar** button. It downloads a small `.ics` file; opening it adds the event (with the location and start time, or as an all-day event if there's no time) to the phone's or computer's calendar.
- **Log game night, and the Hall of fame:** after playing, anyone opens today on the calendar and taps **Log game night**. They choose the game (one from that day's ideas, or search for something else), tick who played, and choose the winner (or "Nobody" for a co-op game or a draw). The **Hall of fame** page (a tab at the top, in gold and orange) then shows **Most wins**, **Most game nights** and every **game played**. Each list can be collapsed; collapsed rankings still show their leader, and the choice is remembered on that device. Wins count games won; game nights count nights you took part in, so a night with three games still counts once. Entries keep the players' names as they were, so history survives a rename or a removal.
- **Last week:** above the calendar there's a collapsible **Last week** section with the seven days before today. If you played on Saturday and nobody logged it, open the section, tap Saturday and use **Log game night**. A game night that happened but wasn't logged gets a **Not logged** tag, and the section opens by itself while there is one. Past days are read-only apart from logging (no changing availability, votes or ideas).
- **Player cards:** tap a player's name anywhere (the Players tab, a day's list, the hall of fame, a campaign) to see their card: wins, win rate (games that had a winner), games, game nights, favourite game, what they're best at, campaigns, recent games, and titles. Right under their name, **Collection** shows the games they saved with *My collection*, favourites first and starred (each links to BoardGameGeek); a short list starts open, a long one (over 8) starts closed. **Champion** goes to whoever has the most wins, **Regular** to whoever has played the most game nights, **Sharpshooter** to the best win rate (at least 3 games with a winner), and **Campaign victor** to anyone who won a campaign. Ties share a title.
- **Campaigns** (a tab, in teal): for long games played over several sessions on different days, like Arcs or Oath. Running campaigns sit in their own **Running campaigns** list (collapsed, it still shows each one's next day), finished ones in **Finished campaigns**, tinted grey with a dashed edge so you can see they're closed.
  - **Start a campaign:** choose the game, optionally name it, tick who's in. You're always in it, and you're its creator.
  - **Join:** anyone can tap **Join** on a running campaign (and **Leave** again) until the creator taps **Lock, everyone's in**. After that only the creator can add people (**Add players**), and can **Unlock** again.
  - **Log session:** anyone in the campaign can log a session (the same popup as Log game night, with a date picker and the game fixed). Right there, while everyone is together, pick **Next session**: it's saved on the campaign and shows on the calendar. **Plan next session** does the same later.
  - **On the calendar:** a day with a planned session of a campaign you're in gets a round teal badge with a flag pinned over its top-left corner (hover it for the campaign's name). Someone else's campaign shows as a small dashed **Campaign** tag instead. Open the day and the campaign shows as a slim one-line strip; tap it to open it up (the choice is remembered on that device). Opened, it shows the campaign's players (faded if they haven't said they're available that day, with an "x of y available" count), **Log session** for people in it, and a **See campaign** button that jumps to it on the Campaigns page. A logged campaign session in the day's **Logged** list links there too.
  - **Finish:** only the creator, who picks the winner (or nobody, for a co-op campaign). A finished campaign is closed (tinted grey): nobody can join it or log sessions. The creator can change their mind with **Reopen**, which puts it back in the running list and clears the winner; its sessions, people and lock stay as they were.
  - **Remove campaign:** the creator can delete their campaign, running or finished, after a confirmation. It can't be undone, but its sessions stay in the hall of fame (they just lose their campaign name).
  - Each campaign's **Sessions** list is collapsed by default (just dates and notes; winners are in the hall of fame). Each session is also an ordinary hall-of-fame entry marked as a campaign session, so it counts as a game night and in the stats.
- **Install as an app:** the **Install as an app** link in the footer adds the site to your home screen (or desktop), where it opens full screen with its own icon. On Chrome it offers a real install button; on iPhone it explains Safari's Share → Add to Home Screen.

## Things to know

- **When the rules change, re-publish them.** Some updates change [`firestore.rules`](firestore.rules). Voting did (days can store `votes`), and so did "I'll bring it", the location and time, and the hall of fame (days can store `brings` and `details`, and there's a new `plays` collection). Campaigns did too (a new `campaigns` collection with people, a lock and a next day, and a note and a campaign link on logged games), and so did editing hall-of-fame entries (an admin can now update a `plays` entry), and the Admin page tools (admins can delete old `days`, and write campaigns back when restoring), campaign notes, the shared games list (`sharedGames`) and feedback (`feedback`), and "My collection" (players can store a `games` list; until you re-publish, saving a list fails, and everything else keeps working). After pulling such an update, paste the file into Firebase console → Firestore Database → **Rules** and **Publish**. Until you do, those features fail to save, and the Hall of fame and Campaigns pages say they can't be loaded; the calendar itself keeps working.
- **No passwords for players.** Tapping a name in "Who are you?" makes that device that person, and from then on it can change that person's days and profile (name and face) for everyone. The site asks "Are you …?" first, but that's a speed bump, not a lock. It's the trade-off for zero sign-up: fine for friends, but don't put anything private in it. Only the admin is verified (Google sign-in), and only for removing players. The same goes for "creator only" in a campaign (locking, adding people once it's locked, finishing, reopening, removing): the site only shows those buttons to the creator, but the database can't tell who is who, so it's a courtesy, not a lock. A signed-in admin can run any campaign. A real lock would mean player accounts (for example Google sign-in per player).
- **If someone ends up as you by mistake:** they tap their name at the top → **Edit profile** → **Switch player** → **I'm new here**. Then you change your own name and face back the same way.
- **Game search is local.** BoardGameGeek's API now requires a private token and blocks browser requests, so the site ships with a compact index of ~14,000 BGG games ([`data/games.json`](data/games.json), built from a public daily ranking dump). A game that isn't in the index can still be added by name (its link opens a BGG search), or by pasting its BGG link. To refresh the index: `node tools/update-games.mjs`.
- **Removing people:** the admin does it from the site (see above). Old days can be tidied in the Firebase console (Firestore Database → `days`).
- **Fixing a hall-of-fame mistake:** the admin opens **Admin → Hall of fame** and taps **Edit** on the entry (or **Remove**, then logs it again). Without the admin set-up, edit or delete it in the Firebase console (Firestore Database → `plays`).
- **If the site looks out of date** (a new tab is missing, a button hasn't changed): the page you're looking at is an old copy that was cached or left open. Reload it with **Ctrl+Shift+R** (**Cmd+Shift+R** on a Mac). The installed app doesn't reload by itself, so close and reopen its window. If a reload still shows the old version, clear the site's data in the browser's settings (you'll be asked "who are you?" again; the calendar data is safe, it lives in the shared database). From now on the site also checks for a new version whenever you come back to it after a while, and shows **A new version of the site is ready** with a **Reload** button. (GitHub Pages tells browsers to keep files for 10 minutes; the service worker now asks the server every time instead, so a reload always gets the latest.)
- **Tests:** `node tools/test.mjs` checks the calendar file, the hall-of-fame numbers, the player stats and titles, the campaign helpers and who may do what in a campaign, the collection and favourites, the help page's links, the Admin page's backup file, restoring one, tidying old days and entry editing, the group's collection, the "last week" dates and the service worker (no browser or install needed).

## Customising

| What | Where |
| --- | --- |
| Players needed for a "game on" day, players needed before ideas can be added, days shown ahead and in "Last week" | [`js/config.js`](js/config.js) (`MIN_PLAYERS`, `MIN_PLAYERS_FOR_IDEAS`, `DAYS_AHEAD`, `DAYS_BEHIND`) |
| The site address used in WhatsApp messages | [`js/config.js`](js/config.js) (`SITE_URL`) |
| The colours: one palette per theme (`--solid` is the purple, `--go` the green) | the two token blocks at the top of [`css/style.css`](css/style.css) (`:root` is light, `:root[data-theme="dark"]` is dark) |
| The Hall of fame's gold and orange, and the Campaigns teal | the `data-page="hall"` and `data-page="campaigns"` blocks right after them in [`css/style.css`](css/style.css) |
| The font (currently [M PLUS Rounded 1c](https://fonts.google.com/specimen/M+PLUS+Rounded+1c)) | `--font` in [`css/style.css`](css/style.css) and the Google Fonts `<link>` in [`index.html`](index.html) |

## Files

```
index.html            page shell
help.html             the "How it works" guide (opened by the ? button)
css/style.css         the 1-bit look
js/app.js             all the UI
js/store-firebase.js  shared backend (Firestore)
js/store-local.js     demo backend (this browser only)
js/games.js           game search + BGG links
js/avatar.js          pixel faces
js/icons.js           vector icons
js/ics.js             builds the "Add to calendar" file
js/hall.js            hall-of-fame rankings, player stats and titles
js/campaigns.js       small helpers for campaigns (sessions, who may do what)
js/collection.js      the group's game collection (who has what, which games nobody has)
js/admin.js           small helpers for the Admin page (backup file, editing an entry)
js/help.js            icons and the dark-mode button on the help page
js/mygames.js         small helpers for a player's game collection (favourites, ordering)
manifest.webmanifest  makes the site installable (name, icons, colours)
sw.js                 service worker: installable, and the page opens offline
icons/                app icons (home screen)
data/games.json       BGG game index
tools/                local server, game-index builder, tests
firestore.rules       database rules to paste into Firebase
```

Data from [BoardGameGeek](https://boardgamegeek.com). This project is not affiliated with BGG.
