#!/bin/bash
set -euo pipefail

ROOT="${FLUTTER_ROOT:-/opt/flutter}"
SITE_SSL="$ROOT/install/nginx/panel.flutter.software.conf"
SITE_HTTP="$ROOT/install/nginx/flutter.conf"
MAP_SRC="$ROOT/install/nginx/upgrade-map.conf"
DOMAIN="${FLUTTER_DOMAIN:-panel.flutter.software}"
CERT="/etc/letsencrypt/live/${DOMAIN}/fullchain.pem"

if [[ ! -f "$MAP_SRC" ]]; then
  echo "Missing $MAP_SRC" >&2
  exit 1
fi

install -m 644 "$MAP_SRC" /etc/nginx/conf.d/flutter-upgrade.conf

if [[ -f "$CERT" ]]; then
  install -m 644 "$SITE_SSL" /etc/nginx/sites-available/flutter
else
  sed "s/__SERVER_NAME__/${DOMAIN}/g" "$SITE_HTTP" > /etc/nginx/sites-available/flutter
  chmod 644 /etc/nginx/sites-available/flutter
fi

ln -sfn /etc/nginx/sites-available/flutter /etc/nginx/sites-enabled/flutter
rm -f /etc/nginx/sites-enabled/default

nginx -t
systemctl reload nginx

rm -rf "$ROOT/apps/web/.next/cache"
systemctl restart flutter-web

echo "Linked ${DOMAIN} → 127.0.0.1:3010 (panel) and 127.0.0.1:4000 (api)"
if [[ -f "$CERT" ]]; then
  echo "HTTPS is enabled. Hard-refresh the browser (Ctrl+Shift+R)."
else
  echo "No Let's Encrypt cert at $CERT — HTTP only."
  echo "  sudo certbot --nginx -d ${DOMAIN}"
fi
