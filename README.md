# MCU - Marvel Cinematic Universe

A personal Marvel Cinematic Universe tracker. Browse every title across all phases, track what you've watched, explore character connections, and follow curated watch paths — all from a single static HTML file with no backend, no dependencies, and no build step.

![MCU Atlas](https://img.shields.io/badge/MCU-78%20titles-E23636?style=flat-square) ![Characters](https://img.shields.io/badge/characters-177-FFD700?style=flat-square) ![Static](https://img.shields.io/badge/static-HTML%2FCSS%2FJS-brightgreen?style=flat-square)

---

## Features

**6 views**
- **Grid** — all titles grouped by phase, with completion rings per phase
- **Timeline** — drag-to-scroll horizontal view sorted by in-universe chronology
- **Connect** — pick any two characters and see every title they share
- **Paths** — 15 curated watch guides (Iron Man complete, Defenders saga, Infinity Saga essentials, and more)
- **Stats** — top characters by appearances, most crowded films, phase completion, total runtime
- **Graph** — D3 force-directed character network; hover to highlight connections, click to drill into a character

**Watched tracker**
Mark any title as watched from the card, the timeline, the side panel, or a path's ordered list. Progress persists in `localStorage`. Phase completion rings and a header progress bar update in real time. Two-click reset in the top-right corner.

**Side panel**
Click any title for a cinematic backdrop hero image (falls back to poster), synopsis, runtime, rating, director, release year, and in-universe year. Full character hub with photos.

**Character modal**
Every character's full MCU filmography with poster thumbnails, phase, and rating. Click any appearance to jump straight to that title's panel.

**Search**
Live search across titles, synopses, character names, aliases, and actors. `Ctrl+K` to focus from anywhere. Keyboard navigation between cards with arrow keys.

---

## Content

| | Count |
|---|---|
| Titles | 78 |
| Characters | 177 |
| Curated paths | 15 |
| Phases covered | 8 |
| Movies | 41 |
| Series | 36 |

**Coverage:** Phase 1–6 · Defenders Saga (all 13 Netflix seasons) · Marvel Television (Agents of S.H.I.E.L.D. S1–7, Agent Carter) · Upcoming Phase 6 (Ironheart, Blade, Spider-Man: Brand New Day, Avengers: Doomsday, Avengers: Secret Wars)

---

## Getting Started

No build step. Just open the file.

```bash
git clone https://github.com/your-username/mcu-atlas.git
cd mcu-atlas
open index.html        # macOS
xdg-open index.html    # Linux
```

Images are pre-downloaded and committed to the repo — the app works fully offline once cloned.

> The character network graph (Graph view) loads D3.js from a CDN. That one view needs an internet connection the first time.

---

## Project Structure

```
mcu-atlas/
├── index.html              # App shell — no framework, no build
├── app.js                  # All app logic (~960 lines, zero dependencies)
├── styles.css              # All styles (~370 lines)
├── data.js                 # All MCU data — titles, characters, phases, paths
├── images/
│   ├── posters/            # Title poster images (w342 from TMDB)
│   ├── backdrops/          # Widescreen backdrops for panel headers
│   └── characters/         # Actor profile photos (w185 from TMDB)
├── download_images.py      # One-time script to fetch images + metadata from TMDB
└── README.md
```

---

## Adding New Titles

The workflow for adding a new MCU title:

**1. Add the entry to `data.js`**

```js
{
  "id": "new-title",
  "title": "Title Name",
  "phase": "6",
  "year": 2026,
  "type": "movie",           // movie | series | special
  "icon": "🎬",
  "col": "#B71C1C",          // accent colour for cards
  "synopsis": "...",
  "chars": ["tony", "peter"],
  "tmdb_id": 123456,
  "tmdb_type": "movie",      // movie | tv
  "timeline_order": 79,      // in-universe chronological position
  "timeline_year": 2026
}
```

**2. Add any new characters to the `characters` array**

```js
{
  "id": "new-char",
  "name": "Full Name",
  "alias": "Hero Name",
  "actor": "Actor Name",
  "col": "#1B5E20"
}
```

**3. Download images and metadata**

```bash
python3 download_images.py
```

This fetches poster, backdrop, actor photos, runtime, rating, and director from TMDB and writes local paths back into `data.js`.

**4. Commit and push**

```bash
git add data.js images/
git commit -m "Add Title Name"
git push
```

---

## Deploying

The app is pure static files. Drop the folder anywhere that serves HTML.

**nginx**
```nginx
server {
    listen 80;
    root /var/www/mcu-atlas;
    location / { try_files $uri $uri/ /index.html; }
}
```

**GitHub Pages / Cloudflare Pages / Netlify**
Point at the repo root — no build command, no output directory needed.

---

## Download Script

`download_images.py` requires Python 3.7+ and a TMDB API key. No third-party packages needed.

```bash
# Set your key
export TMDB_KEY=your_api_key_here

# Download everything (posters + backdrops + character photos + metadata)
python3 download_images.py

# Posters only
python3 download_images.py --posters

# Character photos only
python3 download_images.py --chars

# Force re-download even if files exist
python3 download_images.py --force
```

Get a free TMDB API key at [themoviedb.org/settings/api](https://www.themoviedb.org/settings/api).

> **TMDB IDs for upcoming films** — IDs for unreleased titles are estimates and should be verified at TMDB before running the script. A wrong ID just means no poster downloads; nothing else breaks.

---

## Data Structure

`data.js` exports a single `MCU_DATA` object:

```
MCU_DATA
├── phases[]        8 phases with name, years, sub-label
├── titles[]        78 titles — id, title, phase, year, type, icon, col,
│                   synopsis, chars[], tmdb_id, tmdb_type,
│                   poster_local, backdrop_local, timeline_order,
│                   timeline_year, rating, runtime, director
├── characters[]    177 characters — id, name, alias, actor, col, img_local
└── paths[]         15 curated watch paths — id, name, description,
                    icon, col, titles[]
```

---

## Tech

- **Zero dependencies** at runtime — vanilla HTML, CSS, and JS
- **D3.js** (v7, CDN) for the force-directed graph view only
- **TMDB API** used offline via `download_images.py` — not called at runtime
- **localStorage** for watched progress (survives page refreshes)
- Google Fonts: Bangers, Oswald, Courier Prime

---

## Updating TMDB IDs

If a poster fails to download, the TMDB ID is probably wrong. Find the correct one:

1. Go to [themoviedb.org](https://www.themoviedb.org) and search for the title
2. The ID is in the URL: `themoviedb.org/movie/614930`
3. Update `tmdb_id` in `data.js`
4. Re-run `python3 download_images.py --posters`

---

*Data accurate as of 2025. Upcoming Phase 6 titles (Doomsday, Secret Wars, Spider-Man: Brand New Day) are included with estimated TMDB IDs pending release.*
