#!/usr/bin/env python3
"""
MCU Atlas sync server. Standard library only (Python 3.8+).

Stores watch progress per private sync code and merges it per title
(newest change wins), so several devices can share one list.

  Production (behind nginx, see server/README.md):
    python3 sync_server.py --data-dir /var/lib/mcu-sync

  Local development (serves the site too, same origin as the API):
    python3 server/sync_server.py --dev
    open http://localhost:8787

API
  GET  /api/health
  GET  /api/sync/<CODE>            -> {"items": {...}, "updated": ms}
  POST /api/sync/<CODE>  {"items": {"im1": [1, 1760000000000], ...}}
                                    -> merged {"items": {...}, "updated": ms}

CODE is 24 base32 characters (A-Z, 2-7), ~120 bits of randomness made by the
browser. Files are stored under sha256(CODE), so the data dir never holds codes.
"""

import argparse, hashlib, json, os, re, tempfile, threading, time
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

CODE_RE = re.compile(r"^/api/sync/([A-Z2-7]{24})/?$")
ID_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,47}$")
MAX_BODY = 128 * 1024
MAX_ITEMS = 2000
RATE = 90          # requests per IP per minute
FUTURE_SKEW = 86400 * 1000

locks, locks_guard = {}, threading.Lock()
hits, hits_guard = {}, threading.Lock()


def lock_for(key):
    with locks_guard:
        return locks.setdefault(key, threading.Lock())


def allowed(ip):
    now = time.monotonic()
    with hits_guard:
        recent = [t for t in hits.get(ip, []) if now - t < 60]
        recent.append(now)
        hits[ip] = recent
        if len(hits) > 10000:  # forget idle clients
            for k in [k for k, v in hits.items() if not v or now - v[-1] > 60]:
                hits.pop(k, None)
        return len(recent) <= RATE


def clean_items(raw):
    """Keep only well-formed {id: [0|1, ms]} entries."""
    if not isinstance(raw, dict) or len(raw) > MAX_ITEMS:
        return None
    limit = int(time.time() * 1000) + FUTURE_SKEW
    out = {}
    for k, v in raw.items():
        if not (isinstance(k, str) and ID_RE.match(k)):
            continue
        if not (isinstance(v, list) and len(v) == 2 and v[0] in (0, 1) and isinstance(v[1], (int, float))):
            continue
        out[k] = [int(v[0]), int(min(max(v[1], 0), limit))]
    return out


def merge(stored, incoming):
    for k, (w, ts) in incoming.items():
        cur = stored.get(k)
        if cur is None or ts > cur[1] or (ts == cur[1] and w > cur[0]):
            stored[k] = [w, ts]
    return stored


class Handler(SimpleHTTPRequestHandler):
    server_version = "mcu-sync/1"
    data_dir: Path = Path(".")
    serve_static = False
    trust_proxy = True

    # ── helpers ──
    def client_ip(self):
        ip = self.client_address[0]
        if self.trust_proxy and ip in ("127.0.0.1", "::1"):
            ip = (self.headers.get("X-Forwarded-For") or ip).split(",")[0].strip()
        return ip

    def send_json(self, status, payload):
        body = json.dumps(payload, separators=(",", ":")).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(body)

    def file_for(self, code):
        return self.data_dir / f"{hashlib.sha256(code.encode()).hexdigest()}.json"

    def load(self, path):
        try:
            return json.loads(path.read_text())
        except (FileNotFoundError, ValueError):
            return {"items": {}, "updated": 0}

    def save(self, path, doc):
        fd, tmp = tempfile.mkstemp(dir=self.data_dir, prefix=".tmp-")
        with os.fdopen(fd, "w") as f:
            json.dump(doc, f, separators=(",", ":"))
        os.replace(tmp, path)

    # ── routes ──
    def do_GET(self):
        path = self.path.split("?")[0]
        if path == "/api/health":
            return self.send_json(HTTPStatus.OK, {"ok": True})
        m = CODE_RE.match(path)
        if m:
            if not allowed(self.client_ip()):
                return self.send_json(HTTPStatus.TOO_MANY_REQUESTS, {"error": "slow down"})
            return self.send_json(HTTPStatus.OK, self.load(self.file_for(m.group(1))))
        if path.startswith("/api/"):
            return self.send_json(HTTPStatus.NOT_FOUND, {"error": "not found"})
        if self.serve_static:
            return super().do_GET()
        self.send_json(HTTPStatus.NOT_FOUND, {"error": "not found"})

    def do_HEAD(self):
        if self.serve_static and not self.path.startswith("/api/"):
            return super().do_HEAD()
        self.send_response(HTTPStatus.METHOD_NOT_ALLOWED)
        self.end_headers()

    def do_POST(self):
        m = CODE_RE.match(self.path.split("?")[0])
        if not m:
            return self.send_json(HTTPStatus.NOT_FOUND, {"error": "not found"})
        if not allowed(self.client_ip()):
            return self.send_json(HTTPStatus.TOO_MANY_REQUESTS, {"error": "slow down"})
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            length = -1
        if length <= 0 or length > MAX_BODY:
            return self.send_json(HTTPStatus.REQUEST_ENTITY_TOO_LARGE if length > MAX_BODY else HTTPStatus.BAD_REQUEST, {"error": "bad length"})
        if "application/json" not in (self.headers.get("Content-Type") or ""):
            return self.send_json(HTTPStatus.UNSUPPORTED_MEDIA_TYPE, {"error": "json only"})
        try:
            incoming = clean_items(json.loads(self.rfile.read(length)).get("items"))
        except (ValueError, AttributeError):
            incoming = None
        if incoming is None:
            return self.send_json(HTTPStatus.BAD_REQUEST, {"error": "bad items"})

        path = self.file_for(m.group(1))
        with lock_for(path.name):
            doc = self.load(path)
            before = json.dumps(doc["items"], sort_keys=True)
            merge(doc["items"], incoming)
            if len(doc["items"]) > MAX_ITEMS:
                return self.send_json(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, {"error": "too many items"})
            if json.dumps(doc["items"], sort_keys=True) != before:
                doc["updated"] = int(time.time() * 1000)
                self.save(path, doc)
        self.send_json(HTTPStatus.OK, doc)

    def log_message(self, fmt, *args):
        # no codes in logs: the path is the secret
        msg = fmt % args
        print(re.sub(r"/api/sync/[A-Z2-7]{24}", "/api/sync/<code>", msg), flush=True)


def main():
    ap = argparse.ArgumentParser(description="MCU Atlas sync server")
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=8787)
    ap.add_argument("--data-dir", default=os.environ.get("STATE_DIRECTORY", "./sync-data"))
    ap.add_argument("--dev", action="store_true", help="also serve the site from the repo root")
    args = ap.parse_args()

    data_dir = Path(args.data_dir).resolve()
    data_dir.mkdir(parents=True, exist_ok=True)
    Handler.data_dir = data_dir
    root = Path(__file__).resolve().parent.parent

    if args.dev:
        Handler.serve_static = True
        handler = lambda *a, **kw: Handler(*a, directory=str(root), **kw)
    else:
        handler = Handler

    httpd = ThreadingHTTPServer((args.host, args.port), handler)
    print(f"mcu-sync on http://{args.host}:{args.port}  data: {data_dir}" + ("  (dev: serving site)" if args.dev else ""), flush=True)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
