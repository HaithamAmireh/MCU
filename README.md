# MCU Atlas

A personal Marvel Cinematic Universe tracker. Every film, Disney+ series and special across Phases 1-6, the Defenders Saga and Marvel Television, with your watch progress, what's next, and what's coming. Static HTML/CSS/JS: no backend, no build step.

## What's in it

- **Library**: every title grouped by phase, with an **Up next** panel (in release or story order) and a **Coming up** list with countdowns. Mark titles watched from the card, the detail drawer, or any list.
- **Story order**: titles placed by when they happen in-universe, with the multiverse and alternate-reality entries grouped separately.
- **Crossovers**: pick two characters and see every title they share.
- **Watch paths**: 15 curated routes (character arcs, sagas, essentials) with progress, plus **catch-up plans** for big upcoming releases (e.g. *Before Avengers: Doomsday*): every title sharing a good chunk of the cast plus each character's latest appearance, with hours left and the weekly pace you need.
- **Stats**: hours watched, hours left, most-seen characters, biggest casts, progress by phase.
- **Network**: D3 force graph of who appears with whom.

Progress lives in `localStorage`. Use the **⋯** menu to export it to a JSON file, import it on another device, switch light/dark theme, turn effects down, or reset.

**Effects** (in `fx.js`): Kirby-crackle energy in the Up next panel that follows your cursor, holographic foil tilt on posters, an ink-burst when you stamp a title watched, a starburst seal when a phase is complete, panel-drop reveals, and a live countdown to the next release. Motion defaults to your OS reduced-motion setting and can be switched in the menu; the canvases pause when off-screen or in a background tab.

Each title shows **where to stream it** in your region (picked from your browser language, changeable in the drawer) and a **trailer** that only loads from YouTube (privacy-enhanced mode) when you press play. Stats has a **Share my progress** button that draws a 1080×1350 card you can download or share.

Every screen has its own URL, so links are shareable and the back button works: `#/library`, `#/story`, `#/paths/spidey-complete`, `#/prep/doomsday`, `#/stats`, and any of them with `?title=iw` or `?char=tony` for an open title or character. `#/title/iw` is a short form.

It's an **installable app**: on Android/desktop Chrome use *Install app* in the ⋯ menu; on iPhone, Share, then Add to Home Screen. After the first visit it works offline.

Shortcuts: `/` or `Ctrl/Cmd+K` to search, `Esc` to close, `←`/`→` to step through titles in the open drawer.

## Run it

```bash
python3 server/sync_server.py --dev    # site + sync API on http://localhost:8787
# or any static server (everything except sync works):
python3 -m http.server 8000
```

Images are committed, so everything works offline except the Network view, which loads D3 from cdnjs the first time.

## Keeping it current

`scripts/sync.py` pulls from TMDB and is the only thing you need to keep the data fresh.

```bash
python3 scripts/sync.py                     # refresh ratings, runtimes, dates, cast links, images
python3 scripts/sync.py --discover          # also list MCU titles/seasons TMDB has that data.js doesn't
python3 scripts/sync.py --discover --add    # ...and append them as stubs marked needs_review
python3 scripts/sync.py --only vq,doomsday  # refresh specific titles
```

The key comes from `TMDB_KEY` or `.env` (either the bare key or `TMDB_KEY=...`). Get one at [themoviedb.org/settings/api](https://www.themoviedb.org/settings/api). No pip packages needed.

Per title it:

- checks the TMDB id still points at the right show or film (it flags mismatches instead of overwriting)
- refreshes rating, runtime or episode count, director or showrunner, and the US release date, using season-level data for multi-season shows
- links newly credited actors to existing characters, but only when the role name matches too, so Robert Downey Jr. as Doom doesn't land in *Iron Man*
- downloads the poster, a backdrop and missing character photos
- picks the best official YouTube trailer and records where it streams in 16 regions (with provider logos)

Discovery uses TMDB's MCU keyword and skips making-ofs, recaps and anything in `scripts/sync_ignore.json` (one-shots, shorts, the non-Marvel Studios ABC/Hulu shows). Titles dated after Phase Six are reported but not added.

### Automatic weekly sync

`.github/workflows/sync.yml` runs the sync every Monday and opens a pull request with a summary when anything changed. Add a repository secret named `TMDB_KEY` to enable it. Nothing reaches the live site until you merge.

### Adding a title by hand

Append an entry to `titles` in `data.js`, then run the sync for it:

```js
{
  "id": "new-title",
  "title": "Title Name",
  "phase": "6",                 // 1-6, D (Defenders), S (Marvel Television)
  "year": 2027,
  "type": "movie",              // movie | series | special
  "synopsis": "...",
  "chars": ["sam", "bucky"],    // ids from the characters array
  "tmdb_id": 123456,
  "tmdb_type": "movie",         // movie | tv
  "season": 1,                  // tv only
  "release_date": "2027-05-07", // YYYY-MM-DD, or YYYY-MM if only the month is known
  "timeline_order": 79,         // in-universe position; null for multiverse/alt-reality
  "timeline_year": 2027
}
```

```bash
python3 scripts/sync.py --only new-title
```

## Data

`data.js` defines one `MCU_DATA` object:

| Key | What |
|---|---|
| `phases` | 8 groupings with name, subtitle and years |
| `titles` | 88 titles (as of Oct 2026), including announced ones with release dates |
| `characters` | 212 characters with actor and photo |
| `paths` | 15 curated watch paths |
| `synced_at` | date of the last TMDB sync that changed something |

Release status is computed in the browser from `release_date`, so titles move from "Coming up" to the library on their release day without a data change.

## Sync across devices

Progress is stored per title with a timestamp, and devices merge through a tiny sync service (`server/sync_server.py`, Python standard library only). There are no accounts: *Sync settings* in the ⋯ menu creates a private 24-character code; open the copied link (or type the code) on your other devices. The newest change to each title wins, so marking something on your phone and something else on your laptop never overwrites either.

The server stores files named by a SHA-256 of the code (the code itself is never written to disk or logs), validates every entry, caps request size and rate-limits per IP. Anyone who has the code can read and change that progress, so treat it like a password.

**One-time server setup** (on the Hetzner box, as the deploy user):

1. Push to `main` once. The deploy copies `sync_server.py` and `install.sh` to `~/mcu-sync/`.
2. Run `bash ~/mcu-sync/install.sh`. It creates and starts a hardened `mcu-sync` systemd service on `127.0.0.1:8787` with data in `/var/lib/mcu-sync`.
3. Add the nginx block the script prints (proxies `/api/sync/` to the service), then `sudo nginx -t && sudo systemctl reload nginx`.

After that, every deploy restarts the service automatically. If the server isn't set up, the app still works; sync just reports that it can't reach the server.

## Deploying

Pushing to `main` runs `.github/workflows/deploy_hetzner.yml`, which:

1. refuses to deploy if `scripts/check.py` finds broken data (unknown characters, missing images, bad dates) or any JS/Python file fails to parse
2. copies the site (`index.html`, `app.js`, `fx.js`, `sw.js`, `manifest.webmanifest`, `styles.css`, `data.js`, `images/`) to `DEPLOY_PATH`
3. copies the sync server to `~/mcu-sync/` (outside the web root)
4. reloads nginx and restarts `mcu-sync` if it's installed

The static part works on any host with no build step; only sync needs the Python service.

## Project layout

```
index.html                 app shell
app.js                     all app logic, no dependencies (D3 loaded on demand)
fx.js                      particles, bursts, tilt, reveals, countdown
sw.js                      service worker (offline + install)
manifest.webmanifest       app name, icons, shortcuts
server/sync_server.py      sync API (stdlib Python) + local dev server
server/install.sh          one-time systemd setup on the server
scripts/check.py           data integrity check (runs before deploy)
styles.css                 design tokens + components, light and dark
data.js                    titles, characters, phases, paths
images/                    posters, backdrops, character photos (from TMDB)
scripts/sync.py            TMDB sync + discovery
scripts/sync_ignore.json   TMDB entries deliberately left out
.github/workflows/         deploy + weekly sync
```

Data and images from [TMDB](https://www.themoviedb.org). This product uses the TMDB API but is not endorsed or certified by TMDB.
