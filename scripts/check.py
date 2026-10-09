#!/usr/bin/env python3
"""Sanity checks run before every deploy and on sync PRs. Exits 1 on problems."""

import json, re, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
raw = (ROOT / "data.js").read_text(encoding="utf-8")
D = json.loads(raw[raw.index("{"): raw.rindex("}") + 1])
errors = []

phases = {p["id"] for p in D["phases"]}
chars = {c["id"] for c in D["characters"]}
title_ids = [t["id"] for t in D["titles"]]
titles = set(title_ids)
providers = set((D.get("providers") or {}).keys())

for dup in {i for i in title_ids if title_ids.count(i) > 1}:
    errors.append(f"duplicate title id: {dup}")
if len(chars) != len(D["characters"]):
    errors.append("duplicate character ids")

for t in D["titles"]:
    where = f"title {t.get('id')}"
    for field in ("id", "title", "phase", "year", "type"):
        if field not in t:
            errors.append(f"{where}: missing {field}")
    if t.get("phase") not in phases:
        errors.append(f"{where}: unknown phase {t.get('phase')}")
    if t.get("type") not in ("movie", "series", "special"):
        errors.append(f"{where}: bad type {t.get('type')}")
    if t.get("release_date") and not re.match(r"^\d{4}-\d{2}(-\d{2})?$", t["release_date"]):
        errors.append(f"{where}: bad release_date {t['release_date']}")
    for c in t.get("chars", []):
        if c not in chars:
            errors.append(f"{where}: unknown character {c}")
    for key in ("poster_local", "backdrop_local"):
        if t.get(key) and not (ROOT / t[key]).exists():
            errors.append(f"{where}: missing file {t[key]}")
    for region, ids in (t.get("watch") or {}).items():
        for pid in ids:
            if pid not in providers:
                errors.append(f"{where}: unknown provider {pid} in {region}")

for c in D["characters"]:
    if c.get("img_local") and not (ROOT / c["img_local"]).exists():
        errors.append(f"character {c['id']}: missing file {c['img_local']}")

for p in D["paths"]:
    for tid in p["titles"]:
        if tid not in titles:
            errors.append(f"path {p['id']}: unknown title {tid}")

if errors:
    print("\n".join(errors))
    sys.exit(1)
print(f"data.js OK: {len(titles)} titles, {len(chars)} characters, {len(D['paths'])} paths")
