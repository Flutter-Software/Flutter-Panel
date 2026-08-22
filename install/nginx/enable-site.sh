#!/bin/bash
set -euo pipefail

ROOT="${FLUTTER_ROOT:-/opt/flutter}"
SITE_SRC="$ROOT/install/nginx/panel.flutter.software.conf"
MAP_SRC="$ROOT/install/nginx/upgrade-map.conf"

if [[ ! -f "$SITE_SRC" ]]; then
  echo "Missing $SITE_SRC" >&2
  exit 1
fi

install -m 644 "$MAP_SRC" /etc/nginx/conf.d/flutter-upgrade.conf
install -m 644 "$SITE_SRC" /etc/nginx/sites-available/flutter
ln -sfn /etc/nginx/sites-available/flutter /etc/nginx/sites-enabled/flutter
rm -f /etc/nginx/sites-enabled/default

nginx -t
systemctl reload nginx

echo "Linked panel.flutter.software → 127.0.0.1:3010 (panel) and 127.0.0.1:4000 (api)"
