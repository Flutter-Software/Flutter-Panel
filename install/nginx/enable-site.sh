#!/bin/bash
set -euo pipefail

ROOT="${FLUTTER_ROOT:-/opt/flutter}"
ENV_FILE="$ROOT/.env"
MAP_SRC="$ROOT/install/nginx/upgrade-map.conf"
HTTP_SRC="$ROOT/install/nginx/flutter.conf"
SSL_SRC="$ROOT/install/nginx/flutter-ssl.conf"
LEGACY_SSL="$ROOT/install/nginx/panel.flutter.software.conf"
SITE="/etc/nginx/sites-available/flutter"

DOMAIN="${FLUTTER_DOMAIN:-}"
if [[ -z "$DOMAIN" && -f "$ENV_FILE" ]]; then
  APP_URL="$(awk -F= '/^APP_URL=/{print $2; exit}' "$ENV_FILE" | tr -d '\r' | sed 's:/*$::')"
  DOMAIN="${APP_URL#*://}"
  DOMAIN="${DOMAIN%%/*}"
  DOMAIN="${DOMAIN%%:*}"
fi
DOMAIN="${DOMAIN:-panel.flutter.software}"
CERT="/etc/letsencrypt/live/${DOMAIN}/fullchain.pem"

[[ -f "$MAP_SRC" ]] || { echo "Missing $MAP_SRC" >&2; exit 1; }

if [[ ! -s /proc/net/if_inet6 ]]; then
  drop_ipv6() { sed -i '/listen \[::\]/d' "$1"; }
else
  drop_ipv6() { :; }
fi

render() {
  sed "s/__SERVER_NAME__/${DOMAIN}/g" "$1" > "$SITE"
  drop_ipv6 "$SITE"
  chmod 644 "$SITE"
}

install -m 644 "$MAP_SRC" /etc/nginx/conf.d/flutter-upgrade.conf

if [[ -f "$CERT" ]]; then
  if [[ -f "$SSL_SRC" ]]; then
    render "$SSL_SRC"
  else
    install -m 644 "$LEGACY_SSL" "$SITE"
  fi
else
  render "$HTTP_SRC"
fi

ln -sfn "$SITE" /etc/nginx/sites-enabled/flutter
rm -f /etc/nginx/sites-enabled/default

nginx -t
systemctl reload nginx

rm -rf "$ROOT/apps/web/.next/cache"
systemctl restart flutter-web || true

echo "Linked ${DOMAIN} → 127.0.0.1:3010 (panel) and 127.0.0.1:4000 (api)"
if [[ -f "$CERT" ]]; then
  echo "HTTPS is enabled. Hard-refresh the browser (Ctrl+Shift+R)."
else
  echo "No Let's Encrypt cert at $CERT — HTTP only."
  echo "  sudo FLUTTER_EMAIL=you@example.com bash $ROOT/install/nginx/issue-cert.sh"
fi
