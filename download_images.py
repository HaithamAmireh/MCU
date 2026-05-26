#!/usr/bin/env python3
"""
MCU ATLAS — Image Downloader
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Run ONCE from your project folder to download all title posters
and character images from TMDB into a local images/ folder.

After running, the app uses local files — zero API calls on load.

Usage:
    python3 download_images.py              # normal run
    python3 download_images.py --force      # re-download even if cached
    python3 download_images.py --posters    # posters only
    python3 download_images.py --chars      # characters only

Requirements: Python 3.7+, no extra packages needed.
"""

import json, os, re, sys, time, argparse
import urllib.request, urllib.parse, urllib.error
from pathlib import Path

# ── CONFIG ────────────────────────────────────────────────
API_KEY      = ''
TMDB_API     = 'https://api.themoviedb.org/3'
TMDB_IMG     = 'https://image.tmdb.org/t/p'
POSTER_SIZE  = 'w500'
CHAR_SIZE    = 'w342'
DELAY        = 0.26

# ── PATHS ─────────────────────────────────────────────────
BASE     = Path(__file__).parent
IMG_DIR  = BASE / 'images'
POST_DIR = IMG_DIR / 'posters'
CHAR_DIR = IMG_DIR / 'characters'
DATA_JS  = BASE / 'data.js'
DATA_JSON = BASE / 'data.json'

# ── COLOURS ───────────────────────────────────────────────
USE_COLOR = sys.stdout.isatty() and os.name != 'nt'
def c(code, text): return f'\033[{code}m{text}\033[0m' if USE_COLOR else text
RED   = lambda t: c('31', t)
GREEN = lambda t: c('32', t)
GOLD  = lambda t: c('33', t)
CYAN  = lambda t: c('36', t)
BOLD  = lambda t: c('1',  t)
DIM   = lambda t: c('2',  t)

# ── TMDB IDs (hardcoded so we never depend on data.js having them) ─
TMDB_IDS = {
    'im1':('movie',1726),    'hulk':('movie',1724),    'im2':('movie',10138),
    'thor1':('movie',10195), 'cap1':('movie',1771),    'av1':('movie',24428),
    'im3':('movie',68721),   'thor2':('movie',76338),  'cap2':('movie',100402),
    'gotg1':('movie',118340),'aou':('movie',99861),    'ant1':('movie',102899),
    'cw':('movie',271110),   'ds1':('movie',284052),   'gotg2':('movie',283995),
    'smhc':('movie',315635), 'ragn':('movie',284053),  'bp1':('movie',284054),
    'iw':('movie',299536),   'amw1':('movie',363088),  'cm1':('movie',299537),
    'eg':('movie',299534),   'smffh':('movie',429617), 'bw':('movie',497698),
    'schi':('movie',566525), 'eter':('movie',524434),  'nwh':('movie',634649),
    'mOM':('movie',453395),  'lat':('movie',616037),   'bpwf':('movie',505642),
    'amq':('movie',640146),  'gotg3':('movie',447365), 'tmarv':('movie',609681),
    'dpw':('movie',533535),  'cabnw':('movie',822119), 'tbolt':('movie',986056),
    'ff':('movie',619264),
    'wv':('tv',85271),    'fatws':('tv',108978), 'loki1':('tv',84958),
    'wi1':('tv',91363),   'hw':('tv',88329),     'mk':('tv',92749),
    'msm':('tv',92782),   'shulk':('tv',92783),  'wbn':('tv',197737),
    'si':('tv',114472),   'loki2':('tv',84958),  'echo':('tv',209660),
    'aal':('tv',202555),  'wi2':('tv',91363),    'ddba':('tv',202879),
    'dd1':('tv',61889),   'dd2':('tv',61889),    'dd3':('tv',61889),
    'jj1':('tv',61222),   'jj2':('tv',61222),    'jj3':('tv',61222),
    'lc1':('tv',62126),   'lc2':('tv',62126),    'if1':('tv',62127),
    'if2':('tv',62127),   'def':('tv',69740),    'pun1':('tv',67178),
    'pun2':('tv',67178),
    'shield1':('tv',1403),'shield2':('tv',1403),'shield3':('tv',1403),
    'shield4':('tv',1403),'shield5':('tv',1403),'shield6':('tv',1403),
    'shield7':('tv',1403),'agentc':('tv',61287),
}

# ══════════════════════════════════════════════════════════
# DATA LOADING — tries every strategy, never crashes
# ══════════════════════════════════════════════════════════
def try_parse(text):
    """Try every known way to extract JSON from a JS or JSON file."""
    strategies = [
        # 1. Pure JSON (data.json)
        lambda t: json.loads(t),
        # 2. Find outermost { ... }
        lambda t: json.loads(t[t.index('{') : t.rindex('}')+1]),
        # 3. Strip "const X =" prefix and trailing ";"
        lambda t: json.loads(re.split(r'=\s*', t, maxsplit=1)[1].strip().rstrip(';').rstrip()),
        # 4. Everything after first newline that starts with {
        lambda t: json.loads(next(l for l in t.splitlines() if l.strip().startswith('{'))),
    ]
    last_err = None
    for fn in strategies:
        try:
            data = fn(text)
            if isinstance(data, dict) and 'titles' in data:
                return data
        except Exception as e:
            last_err = e
    return None, last_err

def apply_tmdb_ids(data):
    """Stamp TMDB IDs onto every title that we know about."""
    patched = 0
    for t in data['titles']:
        if t['id'] in TMDB_IDS:
            ttype, tid = TMDB_IDS[t['id']]
            t['tmdb_type'] = ttype
            t['tmdb_id']   = tid
            patched += 1
    return patched

def load_data():
    tried = []

    # ── Try data.js ──────────────────────────────────────
    if DATA_JS.exists():
        tried.append('data.js')
        for enc in ('utf-8', 'utf-8-sig', 'latin-1'):
            try:
                raw  = DATA_JS.read_text(encoding=enc)
                data = try_parse(raw)
                if data and not isinstance(data, tuple):
                    apply_tmdb_ids(data)
                    return data, 'data.js'
            except Exception:
                pass

    # ── Fall back to data.json ───────────────────────────
    if DATA_JSON.exists():
        tried.append('data.json')
        try:
            raw  = DATA_JSON.read_text(encoding='utf-8')
            data = json.loads(raw)
            if data.get('titles'):
                n = apply_tmdb_ids(data)
                print(GOLD(f'  Note: loaded data.json (data.js unreadable) — applied {n} TMDB IDs'))
                return data, 'data.json'
        except Exception as e:
            print(RED(f'  data.json also failed: {e}'))

    print(RED(f'\nERROR: Could not parse any data file. Tried: {tried}'))
    print(DIM('  Make sure data.js or data.json is in the same folder as this script.'))
    print(DIM('  Run: python3 -c "print(open(\'data.js\').read()[50:200])"  to inspect it.'))
    sys.exit(1)

def save_data(data):
    """Write data back to data.js — always pure ASCII so it survives any download."""
    out = 'const MCU_DATA = ' + json.dumps(data, indent=2, ensure_ascii=True) + ';\n'
    DATA_JS.write_text(out, encoding='ascii')

def setup_dirs():
    POST_DIR.mkdir(parents=True, exist_ok=True)
    CHAR_DIR.mkdir(parents=True, exist_ok=True)

# ══════════════════════════════════════════════════════════
# HELPERS
# ══════════════════════════════════════════════════════════
def tmdb_get(endpoint, params=None):
    p = {'api_key': API_KEY, 'language': 'en-US'}
    if params:
        p.update(params)
    url = f"{TMDB_API}/{endpoint}?" + urllib.parse.urlencode(p)
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'MCU-Atlas/1.0'})
        with urllib.request.urlopen(req, timeout=20) as r:
            return json.loads(r.read().decode('utf-8'))
    except urllib.error.HTTPError as e:
        if e.code != 404:
            print(f"    {RED('HTTP')} {e.code} — {endpoint}")
        return None
    except Exception as e:
        print(f"    {RED('ERR')} {e}")
        return None

def download_file(url, dest, force=False):
    if dest.exists() and not force:
        return 'cached'
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'MCU-Atlas/1.0'})
        with urllib.request.urlopen(req, timeout=30) as r:
            data = r.read()
        if len(data) < 500:
            return 'fail'
        dest.write_bytes(data)
        return 'ok'
    except Exception:
        return 'fail'

def bar(done, total, width=28):
    filled = int(width * done / max(total, 1))
    return GOLD(f'[{"█"*filled}{"░"*(width-filled)}]') + f' {done}/{total}'

def clean_actor(raw):
    name = re.sub(r'\s*\(.*?\)', '', raw).strip().rstrip(',').strip()
    return name.split('/')[0].strip()

# ══════════════════════════════════════════════════════════
# POSTERS
# ══════════════════════════════════════════════════════════
def download_posters(data, force=False):
    titles = [t for t in data['titles'] if t.get('tmdb_id')]
    print(f"\n{BOLD('━'*52)}")
    print(BOLD(f"  🎬  TITLE POSTERS  ({len(titles)} titles)"))
    print(f"{BOLD('━'*52)}")

    ok = cached = fail = 0
    for i, t in enumerate(titles, 1):
        dest  = POST_DIR / f"{t['id']}.jpg"
        label = f"[{i:02}/{len(titles)}] {t['title'][:46]:<46}"

        info  = tmdb_get(f"{t['tmdb_type']}/{t['tmdb_id']}")
        if not info or not info.get('poster_path'):
            print(f"  {label}  {RED('✗ no poster')}")
            fail += 1
            time.sleep(DELAY)
            continue

        # Save metadata while we have the full API response
        if info.get('vote_average',0) > 0:
            t['rating'] = round(info['vote_average'], 1)
        if t.get('tmdb_type') == 'movie' and info.get('runtime'):
            t['runtime'] = info['runtime']
        elif info.get('episode_run_time'):
            t['runtime'] = info['episode_run_time'][0]
        # Director (movies only — one extra call)
        if t.get('tmdb_type') == 'movie':
            credits = tmdb_get(f"movie/{t['tmdb_id']}/credits")
            if credits:
                dirs = [c['name'] for c in (credits.get('crew') or []) if c.get('job') == 'Director']
                if dirs:
                    t['director'] = ', '.join(dirs)
            time.sleep(DELAY)

        status = download_file(f"{TMDB_IMG}/{POSTER_SIZE}{info['poster_path']}", dest, force)
        if status == 'ok':
            print(f"  {label}  {GREEN('↓ saved')}")
            t['poster_local'] = f"images/posters/{t['id']}.jpg"
            ok += 1
        elif status == 'cached':
            print(f"  {label}  {DIM('✓ cached')}")
            t['poster_local'] = f"images/posters/{t['id']}.jpg"
            cached += 1
        else:
            print(f"  {label}  {RED('✗ failed')}")
            fail += 1
        time.sleep(DELAY)

    print(f"\n  {bar(ok+cached, len(titles))}  "
          f"{GREEN(f'{ok} new')} · {DIM(f'{cached} cached')}"
          + (f" · {RED(f'{fail} failed')}" if fail else ''))

# ══════════════════════════════════════════════════════════
# CHARACTERS
# ══════════════════════════════════════════════════════════
def download_characters(data, force=False):
    chars = [c for c in data['characters'] if c.get('actor')]
    print(f"\n{BOLD('━'*52)}")
    print(BOLD(f"  🦸  CHARACTER IMAGES  ({len(chars)} characters)"))
    print(f"{BOLD('━'*52)}")

    ok = cached = fail = 0
    for i, c in enumerate(chars, 1):
        dest  = CHAR_DIR / f"{c['id']}.jpg"
        actor = clean_actor(c['actor'])
        label = f"[{i:03}/{len(chars)}] {c['name'][:26]:<26} ({actor[:22]})"

        result = tmdb_get('search/person', {'query': actor})
        if not result or not result.get('results'):
            print(f"  {label}  {RED('✗ not found')}")
            fail += 1
            time.sleep(DELAY)
            continue

        person = next((r for r in result['results'][:3] if r.get('profile_path')), None)
        if not person:
            print(f"  {label}  {RED('✗ no image')}")
            fail += 1
            time.sleep(DELAY)
            continue

        status = download_file(f"{TMDB_IMG}/{CHAR_SIZE}{person['profile_path']}", dest, force)
        if status == 'ok':
            print(f"  {label}  {GREEN('↓ saved')}")
            c['img_local'] = f"images/characters/{c['id']}.jpg"
            ok += 1
        elif status == 'cached':
            print(f"  {label}  {DIM('✓ cached')}")
            c['img_local'] = f"images/characters/{c['id']}.jpg"
            cached += 1
        else:
            print(f"  {label}  {RED('✗ failed')}")
            fail += 1
        time.sleep(DELAY)

    print(f"\n  {bar(ok+cached, len(chars))}  "
          f"{GREEN(f'{ok} new')} · {DIM(f'{cached} cached')}"
          + (f" · {RED(f'{fail} failed')}" if fail else ''))

# ══════════════════════════════════════════════════════════
# MAIN
# ══════════════════════════════════════════════════════════
def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--force',   action='store_true')
    parser.add_argument('--posters', action='store_true')
    parser.add_argument('--chars',   action='store_true')
    args = parser.parse_args()
    do_all = not args.posters and not args.chars

    print(BOLD(GOLD('\n  ★  MCU ATLAS — Image Downloader  ★')))
    print(DIM('  Uses TMDB IDs from data.js — no search guessing, correct every time.'))

    setup_dirs()
    data, source = load_data()
    print(DIM(f'  Loaded {len(data["titles"])} titles, {len(data["characters"])} characters from {source}'))

    start = time.time()
    if do_all or args.posters:
        download_posters(data, force=args.force)
    if do_all or args.chars:
        download_characters(data, force=args.force)

    save_data(data)

    elapsed = time.time() - start
    print(f"\n{BOLD('━'*52)}")
    print(BOLD(GREEN(f'  ✅  Done in {elapsed:.1f}s')))
    print(f"  Images saved to : {CYAN(str(IMG_DIR))}")
    print(f"  data.js updated : local paths written in")
    print(f"{BOLD('━'*52)}\n")

if __name__ == '__main__':
    main()
