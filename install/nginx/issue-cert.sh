#!/bin/bash
# Issue or renew a Let's Encrypt cert for the panel hostname in APP_URL.
#
#   sudo bash /opt/flutter/install/nginx/issue-cert.sh
#   sudo FLUTTER_EMAIL=you@example.com bash /opt/flutter/install/nginx/issue-cert.sh
set -euo pipefail

ROOT="${FLUTTER_ROOT:-/opt/flutter}"
ENV_FILE="$ROOT/.env"
MAP_SRC="$ROOT/install/nginx/upgrade-map.conf"
HTTP_SRC="$ROOT/install/nginx/flutter.conf"
SSL_SRC="$ROOT/install/nginx/flutter-ssl.conf"
SITE="/etc/nginx/sites-available/flutter"

[[ -f "$ENV_FILE" ]] || { echo "Missing $ENV_FILE" >&2; exit 1; }
[[ -f "$MAP_SRC" && -f "$HTTP_SRC" && -f "$SSL_SRC" ]] || { echo "Missing nginx templates in $ROOT/install/nginx" >&2; exit 1; }

APP_URL="$(awk -F= '/^APP_URL=/{print $2; exit}' "$ENV_FILE" | tr -d '\r' | sed 's:/*$::')"
DOMAIN="${FLUTTER_DOMAIN:-}"
if [[ -z "$DOMAIN" ]]; then
  DOMAIN="${APP_URL#*://}"
  DOMAIN="${DOMAIN%%/*}"
  DOMAIN="${DOMAIN%%:*}"
fi
[[ -n "$DOMAIN" ]] || { echo "Could not parse hostname from APP_URL=$APP_URL" >&2; exit 1; }
if [[ "$DOMAIN" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]]; then
  echo "Let's Encrypt cannot issue a certificate for IP $DOMAIN. Point a hostname at this server and set APP_URL." >&2
  exit 1
fi

EMAIL="${FLUTTER_EMAIL:-}"
if [[ -z "$EMAIL" && -f /etc/letsencrypt/renewal/${DOMAIN}.conf ]]; then
  EMAIL="$(awk -F= '/^[[:space:]]*email[[:space:]]*=/{gsub(/[[:space:]]/, "", $2); print $2; exit}' "/etc/letsencrypt/renewal/${DOMAIN}.conf" || true)"
fi
if [[ -z "$EMAIL" ]]; then
  echo "Set FLUTTER_EMAIL for Let's Encrypt (e.g. sudo FLUTTER_EMAIL=you@example.com $0)" >&2
  exit 1
fi

if [[ ! -s /proc/net/if_inet6 ]]; then
  drop_ipv6() { sed -i '/listen \[::\]/d' "$1"; }
else
  drop_ipv6() { :; }
fi

render() {
  local src="$1" dest="$2"
  sed "s/__SERVER_NAME__/${DOMAIN}/g" "$src" > "$dest"
  drop_ipv6 "$dest"
  chmod 644 "$dest"
}

echo "[flutter] Domain: ${DOMAIN}"
echo "[flutter] Email:  ${EMAIL}"

apt-get install -y --no-install-recommends certbot python3-certbot-nginx >/dev/null
install -d -m 755 /var/www/html
install -m 644 "$MAP_SRC" /etc/nginx/conf.d/flutter-upgrade.conf

render "$HTTP_SRC" "$SITE"

ln -sfn "$SITE" /etc/nginx/sites-enabled/flutter
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx

certbot certonly --webroot -w /var/www/html --non-interactive --agree-tos --no-eff-email \
  --email "$EMAIL" -d "$DOMAIN" --keep-until-expiring --expand

CERT="/etc/letsencrypt/live/${DOMAIN}/fullchain.pem"
KEY="/etc/letsencrypt/live/${DOMAIN}/privkey.pem"
[[ -f "$CERT" && -f "$KEY" ]] || { echo "Certbot did not write $CERT" >&2; exit 1; }

render "$SSL_SRC" "$SITE"
nginx -t
systemctl reload nginx

if grep -q "^COOKIE_SECURE=" "$ENV_FILE"; then
  sed -i "s|^COOKIE_SECURE=.*|COOKIE_SECURE=true|" "$ENV_FILE"
else
  echo "COOKIE_SECURE=true" >> "$ENV_FILE"
fi
if [[ "$APP_URL" == http://* ]]; then
  sed -i "s|^APP_URL=.*|APP_URL=https://${DOMAIN}|" "$ENV_FILE"
fi

systemctl restart flutter-api flutter-web || true
systemctl enable --now certbot.timer >/dev/null 2>&1 || true

echo
echo "HTTPS is enabled for https://${DOMAIN}"
openssl x509 -in "$CERT" -noout -subject -issuer -dates
echo
echo "Hard-refresh the browser (Ctrl+Shift+R). If it still says Not secure, you are"
echo "opening a different hostname than ${DOMAIN} (IP, www, or mail.*)."
