#!/usr/bin/env python3
"""
MCU Atlas sync: keeps data.js current with TMDB.

  python3 scripts/sync.py                 refresh metadata + download missing images
  python3 scripts/sync.py --discover      also list MCU titles/seasons TMDB knows that data.js doesn't
  python3 scripts/sync.py --discover --add    ...and append them as stubs (needs_review: true)
  python3 scripts/sync.py --force-images  re-download every image
  python3 scripts/sync.py --only ff,vq    limit the refresh to some title ids
  python3 scripts/sync.py --report out.md write a markdown summary (used by the GitHub workflow)

API key: TMDB_KEY env var, or a .env file in the repo root containing either the
bare key or TMDB_KEY=... . No third-party packages needed (Python 3.8+).

What it does per title:
  * verifies the TMDB id still points at the right show/film (name check)
  * refreshes rating, runtime, director/showrunner, release date, episode count
  * links newly credited actors to existing characters (adds only, never removes)
  * downloads the poster, a backdrop, and photos for characters without one
"""

import argparse, json, os, re, sys, time, unicodedata
import urllib.request, urllib.parse, urllib.error
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA_JS = ROOT / "data.js"
IMG = ROOT / "images"
POSTERS, BACKDROPS, CHARS = IMG / "posters", IMG / "backdrops", IMG / "characters"
IGNORE_FILE = Path(__file__).resolve().parent / "sync_ignore.json"

API = "https://api.themoviedb.org/3"
IMG_CDN = "https://image.tmdb.org/t/p"
MCU_KEYWORD = 180547  # TMDB keyword "marvel cinematic universe (mcu)"
# Making-ofs, recaps and podcasts share the keyword; they aren't story titles.
NOT_A_TITLE = re.compile(r"assembled|legends|making of|podcast|countdown to|special look|gallery|recap", re.I)
DELAY = 0.12

USE_COLOR = sys.stdout.isatty() and os.name != "nt"
def _c(code):
    return lambda s: f"\033[{code}m{s}\033[0m" if USE_COLOR else str(s)
RED, GREEN, GOLD, DIM, BOLD = _c(31), _c(32), _c(33), _c(2), _c(1)


# ── key + data io ─────────────────────────────────────────
def load_key():
    key = os.environ.get("TMDB_KEY", "").strip()
    env = ROOT / ".env"
    if not key and env.exists():
        for line in env.read_text().splitlines():
            line = line.strip().strip('"')
            if not line or line.startswith("#"):
                continue
            key = line.split("=", 1)[1].strip().strip('"') if "=" in line else line
            break
    if not key:
        sys.exit(RED("No TMDB key. Set TMDB_KEY or put the key in .env"))
    return key


def load_data():
    raw = DATA_JS.read_text(encoding="utf-8")
    return json.loads(raw[raw.index("{"): raw.rindex("}") + 1])


def save_data(data):
    out = "const MCU_DATA = " + json.dumps(data, indent=2, ensure_ascii=False) + ";\n"
    DATA_JS.write_text(out, encoding="utf-8")


# ── http ──────────────────────────────────────────────────
KEY = None

def tmdb(path, **params):
    params = {"api_key": KEY, "language": "en-US", **params}
    url = f"{API}/{path}?{urllib.parse.urlencode(params)}"
    req = urllib.request.Request(url, headers={"User-Agent": "MCU-Atlas-sync/2"})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=20) as r:
                time.sleep(DELAY)
                return json.loads(r.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None
            if e.code == 429:
                time.sleep(2 + attempt * 2)
                continue
            print(RED(f"    HTTP {e.code} on {path}"))
            return None
        except Exception as e:  # network blip
            if attempt == 2:
                print(RED(f"    {e} on {path}"))
            time.sleep(1)
    return None


def download(url_path, size, dest, force=False):
    if not url_path:
        return False
    if dest.exists() and not force:
        return True
    try:
        req = urllib.request.Request(f"{IMG_CDN}/{size}{url_path}", headers={"User-Agent": "MCU-Atlas-sync/2"})
        with urllib.request.urlopen(req, timeout=30) as r:
            body = r.read()
        if len(body) < 500:
            return False
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(body)
        return True
    except Exception:
        return False


# ── helpers ───────────────────────────────────────────────
def norm(s):
    s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode().lower()
    s = re.sub(r"^marvel( studios)?'?s?\s+", "", s)
    s = re.sub(r"\bseason \d+\b", "", s)
    return re.sub(r"[^a-z0-9]+", "", s.replace("&", "and").replace("4", "four"))


def names_match(ours, theirs):
    a, b = norm(ours), norm(theirs)
    return bool(a and b) and (a in b or b in a)


def clean_actor(raw):
    return re.sub(r"\s*\(.*?\)", "", raw or "").split("/")[0].strip().lower()


def slugify(s):
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")[:24]


def us_release(movie):
    """Prefer the US theatrical/digital date; TMDB's release_date is the earliest worldwide."""
    for country in (movie.get("release_dates") or {}).get("results", []):
        if country.get("iso_3166_1") == "US":
            for kind in (3, 2, 4):  # theatrical, then limited, then digital
                dates = sorted(d["release_date"][:10] for d in country["release_dates"] if d.get("type") == kind)
                if dates:
                    return dates[0]
    return movie.get("release_date") or None


SAGA_END = "2027-12-31"  # Phase Six closes with Avengers: Secret Wars


def phase_for(release):
    if not release:
        return "6"
    return "6" if release >= "2025-07-25" else "5"


def actor_index(data):
    idx = {}
    for c in data["characters"]:
        for name in re.split(r"\s*/\s*", c.get("actor") or ""):
            name = clean_actor(name)
            if name:
                idx.setdefault(name, []).append(c)
    return idx


def role_tokens(c):
    words = re.findall(r"[a-z0-9]+", norm_words(f"{c['name']} {c.get('alias', '')}"))
    return {w for w in words if len(w) >= 4 and w not in {"captain", "doctor", "agent", "director", "formerly", "head", "security"}}


def norm_words(s):
    return unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode().lower().replace(".", "")


def credited_chars(credits, idx, cast_limit=30):
    """Link a credit to a character only when the actor AND the role name agree.
    Actors play several parts (Downey: Stark and Doom; Bettany: JARVIS, Vision)."""
    found = []
    for person in (credits or {}).get("cast", [])[:cast_limit]:
        role = person.get("character") or " ".join(r.get("character", "") for r in person.get("roles", []))
        role_words = set(re.findall(r"[a-z0-9]+", norm_words(role)))
        scored = []
        for c in idx.get((person.get("name") or "").lower(), []):
            tokens = role_tokens(c)
            if tokens & role_words:
                scored.append((len(tokens & role_words) / len(tokens), c["id"]))
        if scored:
            best = max(scored)
            if [s for s in scored if s[0] == best[0]] == [best] and best[1] not in found:
                found.append(best[1])
    return found


# ── refresh one title ─────────────────────────────────────
def refresh_title(t, idx, force_images, log):
    kind, tid = t.get("tmdb_type"), t.get("tmdb_id")
    season = t.get("season") or (1 if kind == "tv" else None)
    if not kind or not tid:
        log["skipped"].append(t["id"])
        return

    if kind == "movie":
        info = tmdb(f"movie/{tid}", append_to_response="credits,release_dates")
    else:
        info = tmdb(f"tv/{tid}", append_to_response="aggregate_credits")
    if not info:
        log["broken"].append(f"`{t['id']}` {t['title']}: TMDB {kind}/{tid} not found")
        return

    their_name = info.get("title") or info.get("name") or ""
    if not names_match(t["title"], their_name):
        log["mismatch"].append(f"`{t['id']}` {t['title']}: TMDB {kind}/{tid} is \"{their_name}\"")
        return

    changes = []
    def setf(field, value):
        if value in (None, "", [], 0):
            return
        if t.get(field) != value:
            changes.append(field)
            t[field] = value

    poster, credits = info.get("poster_path"), None
    if kind == "movie":
        credits = info.get("credits")
        setf("runtime", info.get("runtime"))
        setf("release_date", us_release(info))
        dirs = [c["name"] for c in (credits or {}).get("crew", []) if c.get("job") == "Director"]
        setf("director", ", ".join(dirs))
        votes, rating = info.get("vote_count", 0), info.get("vote_average", 0)
    else:
        creators = [c["name"] for c in info.get("created_by", [])]
        if season:
            s = tmdb(f"tv/{tid}/season/{season}", append_to_response="aggregate_credits")
            if not s:
                # Announced season TMDB hasn't created yet: keep our date, nothing to refresh.
                log["pending"].append(t["id"])
                return
            eps = s.get("episodes") or []
            runtimes = [e["runtime"] for e in eps if e.get("runtime")]
            setf("episodes", len(eps) or None)
            setf("runtime", round(sum(runtimes) / len(runtimes)) if runtimes else None)
            setf("release_date", s.get("air_date"))
            poster = s.get("poster_path") or poster
            credits = s.get("aggregate_credits")
            voted = [e for e in eps if e.get("vote_count", 0) >= 5]
            votes = sum(e["vote_count"] for e in voted)
            rating = (sum(e["vote_average"] * e["vote_count"] for e in voted) / votes) if votes else 0
        else:
            credits = info.get("aggregate_credits")
            setf("episodes", info.get("number_of_episodes"))
            rt = info.get("episode_run_time") or []
            setf("runtime", rt[0] if rt else None)
            setf("release_date", info.get("first_air_date"))
            votes, rating = info.get("vote_count", 0), info.get("vote_average", 0)
        setf("director", ", ".join(creators[:2]))

    if votes >= 20 and rating:
        setf("rating", round(rating, 1))
    if t.get("release_date"):
        setf("year", int(t["release_date"][:4]))

    new_chars = [c for c in credited_chars(credits, idx) if c not in t.get("chars", [])]
    if new_chars:
        t.setdefault("chars", []).extend(new_chars)
        log["cast"].append(f"`{t['id']}` +{', '.join(new_chars)}")

    if download(poster, "w500", POSTERS / f"{t['id']}.jpg", force_images):
        setf("poster_local", f"images/posters/{t['id']}.jpg")
    if download(info.get("backdrop_path"), "w780", BACKDROPS / f"{t['id']}.jpg", force_images):
        setf("backdrop_local", f"images/backdrops/{t['id']}.jpg")

    if changes:
        log["updated"].append(f"`{t['id']}` {', '.join(changes)}")


# ── characters ────────────────────────────────────────────
def refresh_characters(data, force_images, log):
    for c in data["characters"]:
        dest = CHARS / f"{c['id']}.jpg"
        if dest.exists() and not force_images:
            c["img_local"] = f"images/characters/{c['id']}.jpg"
            continue
        actor = clean_actor(c.get("actor"))
        if not actor:
            continue
        res = tmdb("search/person", query=actor) or {}
        person = next((p for p in res.get("results", [])[:3] if p.get("profile_path")), None)
        if person and download(person["profile_path"], "w342", dest, True):
            c["img_local"] = f"images/characters/{c['id']}.jpg"
            log["photos"].append(c["id"])


# ── discovery ─────────────────────────────────────────────
def discover(data, add, log):
    ignore = set(json.loads(IGNORE_FILE.read_text())["ids"]) if IGNORE_FILE.exists() else set()
    known_movies = {t["tmdb_id"] for t in data["titles"] if t.get("tmdb_type") == "movie"}
    known_seasons = {}
    for t in data["titles"]:
        if t.get("tmdb_type") == "tv":
            known_seasons.setdefault(t["tmdb_id"], set()).add(t.get("season") or 1)
    idx = actor_index(data)
    found = []

    def paged(kind):
        page, results = 1, []
        while True:
            r = tmdb(f"discover/{kind}", with_keywords=MCU_KEYWORD, page=page) or {}
            results += r.get("results", [])
            if page >= r.get("total_pages", 1):
                return results
            page += 1

    for m in paged("movie"):
        key = f"movie/{m['id']}"
        if m["id"] in known_movies or key in ignore or NOT_A_TITLE.search(m["title"]):
            continue
        found.append(("movie", m["id"], None, m["title"], m.get("release_date")))

    for s in paged("tv"):
        key = f"tv/{s['id']}"
        if key in ignore or NOT_A_TITLE.search(s["name"]):
            continue
        have = known_seasons.get(s["id"], set())
        if not have:
            found.append(("tv", s["id"], 1, s["name"], s.get("first_air_date")))
            continue
        detail = tmdb(f"tv/{s['id']}") or {}
        for season in detail.get("seasons", []):
            n = season.get("season_number")
            if n and n not in have and f"{key}/{n}" not in ignore:
                found.append(("tv", s["id"], n, f"{s['name']} Season {n}", season.get("air_date")))

    for kind, tid, season, name, released in found:
        label = f"{kind}/{tid}" + (f"/{season}" if season and season > 1 else "")
        log["discovered"].append(f"{name} ({released or 'TBA'}) `{label}`")
        # Only auto-add dated titles inside the current saga; later films get
        # reported every run until you add a phase for them.
        if not add or not released or released > SAGA_END:
            continue
        info = tmdb(f"{kind}/{tid}", append_to_response="credits" if kind == "movie" else "aggregate_credits") or {}
        credits = info.get("credits") or info.get("aggregate_credits")
        base_id = slugify(name)
        new_id, n = base_id, 2
        while any(t["id"] == new_id for t in data["titles"]):
            new_id, n = f"{base_id}-{n}", n + 1
        data["titles"].append({
            "id": new_id,
            "title": name,
            "phase": phase_for(released),
            "year": int(released[:4]) if released else date.today().year + 1,
            "type": "movie" if kind == "movie" else "series",
            "icon": "★",
            "col": "#B71C1C",
            "synopsis": info.get("overview") or "",
            "chars": credited_chars(credits, idx),
            "tmdb_id": tid,
            "tmdb_type": kind,
            **({"season": season} if kind == "tv" else {}),
            "release_date": released or None,
            "timeline_order": None,
            "timeline_year": None,
            "needs_review": True,
        })
        log["added"].append(new_id)


# ── main ──────────────────────────────────────────────────
def main():
    global KEY
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--discover", action="store_true", help="look for MCU titles missing from data.js")
    ap.add_argument("--add", action="store_true", help="with --discover: append them as stubs")
    ap.add_argument("--only", help="comma-separated title ids to refresh")
    ap.add_argument("--force-images", action="store_true")
    ap.add_argument("--no-images", action="store_true", help="skip character photo downloads")
    ap.add_argument("--report", help="write a markdown summary to this path")
    args = ap.parse_args()

    KEY = load_key()
    data = load_data()
    log = {k: [] for k in ("updated", "cast", "mismatch", "broken", "pending", "skipped",
                           "photos", "discovered", "added")}

    if args.discover:
        print(BOLD("Discovering new MCU titles on TMDB..."))
        discover(data, args.add, log)

    only = set(args.only.split(",")) if args.only else None
    titles = [t for t in data["titles"] if not only or t["id"] in only]
    idx = actor_index(data)
    print(BOLD(f"Refreshing {len(titles)} titles..."))
    for i, t in enumerate(titles, 1):
        print(DIM(f"  [{i:>3}/{len(titles)}] {t['title']}"), end="\r" if USE_COLOR else "\n")
        refresh_title(t, idx, args.force_images, log)
    print()

    if not args.no_images:
        print(BOLD("Checking character photos..."))
        refresh_characters(data, args.force_images, log)

    order = {p["id"]: i for i, p in enumerate(data["phases"])}
    data["titles"].sort(key=lambda t: (order.get(t["phase"], 99), t.get("release_date") or "9999", t["id"]))
    if any(log[k] for k in ("updated", "cast", "photos", "added")):
        data["synced_at"] = date.today().isoformat()
    save_data(data)

    sections = [
        ("New on TMDB, not in data.js", "discovered"),
        ("Added as stubs (review synopsis, phase, timeline)", "added"),
        ("TMDB id points at a different title", "mismatch"),
        ("TMDB id not found", "broken"),
        ("Metadata changed", "updated"),
        ("Newly credited characters linked", "cast"),
        ("New character photos", "photos"),
        ("Announced seasons TMDB hasn't created yet", "pending"),
    ]
    md = [f"# MCU Atlas sync, {date.today().isoformat()}", ""]
    for heading, key in sections:
        if log[key]:
            md += [f"## {heading} ({len(log[key])})", *[f"- {x}" for x in log[key]], ""]
    if len(md) == 2:
        md.append("Nothing changed.")
    text = "\n".join(md)
    print(text)
    if args.report:
        Path(args.report).write_text(text + "\n")
    if log["mismatch"] or log["broken"]:
        print(GOLD("\nSome TMDB ids need attention (see above)."))


if __name__ == "__main__":
    main()
