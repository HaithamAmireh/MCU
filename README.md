# MCU Atlas

A personal Marvel Cinematic Universe tracker. Every film, Disney+ series and special across Phases 1-6, the Defenders Saga and Marvel Television, with your watch progress, what's next, and what's coming. Static HTML/CSS/JS: no backend, no build step.

## What's in it

- **Library**: every title grouped by phase, with an **Up next** panel (in release or story order) and a **Coming up** list with countdowns. Mark titles watched from the card, the detail drawer, or any list.
- **Story order**: titles placed by when they happen in-universe, with the multiverse and alternate-reality entries grouped separately.
- **Crossovers**: pick two characters and see every title they share.
- **Watch paths**: 15 curated routes (character arcs, sagas, essentials) with progress.
- **Stats**: hours watched, hours left, most-seen characters, biggest casts, progress by phase.
- **Network**: D3 force graph of who appears with whom.

Progress lives in `localStorage`. Use the **⋯** menu to export it to a JSON file, import it on another device, switch light/dark theme, turn effects down, or reset.

**Effects** (in `fx.js`): Kirby-crackle energy in the Up next panel that follows your cursor, holographic foil tilt on posters, an ink-burst when you stamp a title watched, a starburst seal when a phase is complete, panel-drop reveals, and a live countdown to the next release. Motion defaults to your OS reduced-motion setting and can be switched in the menu; the canvases pause when off-screen or in a background tab.

Shortcuts: `/` or `Ctrl/Cmd+K` to search, `Esc` to close, `←`/`→` to step through titles in the open drawer.

## Run it

```bash
open index.html                 # or serve the folder:
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

## Deploying

Pushing to `main` runs `.github/workflows/deploy_hetzner.yml`, which copies `index.html`, `app.js`, `fx.js`, `styles.css`, `data.js` and `images/` to the server and reloads nginx. Any static host works the same way: no build command, serve the repo root.

## Project layout

```
index.html                 app shell
app.js                     all app logic, no dependencies (D3 loaded on demand)
fx.js                      particles, bursts, tilt, reveals, countdown
styles.css                 design tokens + components, light and dark
data.js                    titles, characters, phases, paths
images/                    posters, backdrops, character photos (from TMDB)
scripts/sync.py            TMDB sync + discovery
scripts/sync_ignore.json   TMDB entries deliberately left out
.github/workflows/         deploy + weekly sync
```

Data and images from [TMDB](https://www.themoviedb.org). This product uses the TMDB API but is not endorsed or certified by TMDB.
