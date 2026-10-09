#!/usr/bin/env bash
# One-time setup of the MCU Atlas sync service on the server.
# Run as the same user the GitHub deploy logs in as (HETZNER_USER):
#
#   bash ~/mcu-sync/install.sh
#
# The deploy workflow copies sync_server.py to ~/mcu-sync/ on every push and
# restarts the service; this script only has to run once.
set -euo pipefail

APP_DIR="$HOME/mcu-sync"
RUN_USER="$(id -un)"
PYTHON="$(command -v python3)"
UNIT=/etc/systemd/system/mcu-sync.service

if [[ ! -f "$APP_DIR/sync_server.py" ]]; then
  echo "Expected $APP_DIR/sync_server.py. Push to main once so the deploy copies it, then re-run." >&2
  exit 1
fi

echo "Writing $UNIT (runs as $RUN_USER)"
sudo tee "$UNIT" >/dev/null <<EOF
[Unit]
Description=MCU Atlas sync API
After=network.target

[Service]
User=$RUN_USER
ExecStart=$PYTHON $APP_DIR/sync_server.py --host 127.0.0.1 --port 8787
StateDirectory=mcu-sync
Restart=on-failure
RestartSec=3
NoNewPrivileges=yes
PrivateTmp=yes
ProtectSystem=strict
ProtectHome=read-only
ProtectKernelTunables=yes
ProtectControlGroups=yes
RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX
MemoryMax=128M

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now mcu-sync
sleep 1
curl -fsS http://127.0.0.1:8787/api/health && echo "  <- sync service is up"

cat <<'EOF'

Last step: proxy /api/sync/ through nginx. Add this inside the server { } block
that serves the site (same place as your root/location / config):

    location /api/sync/ {
        proxy_pass http://127.0.0.1:8787;
        proxy_set_header X-Forwarded-For $remote_addr;
        client_max_body_size 256k;
        access_log off;   # the URL contains the private sync code
    }

    location = /api/health { proxy_pass http://127.0.0.1:8787; }

Then:  sudo nginx -t && sudo systemctl reload nginx
EOF
