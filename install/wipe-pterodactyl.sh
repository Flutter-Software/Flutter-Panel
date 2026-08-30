#!/usr/bin/env bash
# Force-remove Pterodactyl (and Pelican) from this host: Wings, panel, Docker
# game containers, networks, and port bindings (8080, 2022, allocated game ports).
# Leaves Docker Engine, nginx, Node.js, and any Flutter install in place.
#
#   sudo bash install/wipe-pterodactyl.sh --yes
#   sudo bash install/wipe-pterodactyl.sh --yes --wings-only
#
# Options:
#   --yes / -y         Do not prompt
#   --wings-only       Remove Wings + game containers only (leave the panel files)
#   --keep-data        Leave /var/lib/pterodactyl (and Pelican data dirs)
#   --drop-db          Drop the panel MySQL/MariaDB database and user
#   --purge-php        apt-get purge php-* and composer (panel-only packages)
#   --wipe-certs       Delete Let's Encrypt certs whose name contains ptero/pelican
set -euo pipefail

YES=0
MODE="all"
KEEP_DATA=0
DROP_DB=0
PURGE_PHP=0
WIPE_CERTS=0

log() { printf '[ptero-wipe] %s\n' "$*"; }
warn() { printf '[ptero-wipe] warning: %s\n' "$*" >&2; }
die() { printf '[ptero-wipe] error: %s\n' "$*" >&2; exit 1; }

usage() {
  sed -n '2,20p' "$0"
  exit 0
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --yes|-y) YES=1 ;;
    --wings-only) MODE="wings" ;;
    --keep-data) KEEP_DATA=1 ;;
    --drop-db) DROP_DB=1 ;;
    --purge-php) PURGE_PHP=1 ;;
    --wipe-certs) WIPE_CERTS=1 ;;
    --help|-h) usage ;;
    *) die "Unknown option: $1 (see --help)" ;;
  esac
  shift
done

[[ "$(id -u)" -eq 0 ]] || die "Run as root: sudo bash install/wipe-pterodactyl.sh"

stop_unit() {
  local unit="$1"
  systemctl disable --now "$unit" 2>/dev/null || true
  systemctl stop "$unit" 2>/dev/null || true
  rm -f "/etc/systemd/system/${unit}" "/lib/systemd/system/${unit}" "/usr/lib/systemd/system/${unit}"
  rm -rf "/etc/systemd/system/${unit}.d" "/lib/systemd/system/${unit}.d" "/usr/lib/systemd/system/${unit}.d"
}

kill_matching() {
  local pattern="$1"
  pkill -f "$pattern" 2>/dev/null || true
  sleep 0.2
  pkill -9 -f "$pattern" 2>/dev/null || true
}

yaml_value() {
  local file="$1" key="$2"
  [[ -f "$file" ]] || return 0
  awk -v key="$key" '
    $0 ~ "^[[:space:]]*" key ":[[:space:]]*" {
      sub("^[^:]+:[[:space:]]*", "")
      gsub(/["'\'']/, "")
      print
      exit
    }
  ' "$file" 2>/dev/null || true
}

env_value() {
  local file="$1" key="$2"
  [[ -f "$file" ]] || return 0
  awk -F= -v key="$key" '
    $1 == key {
      sub(/^[^=]+=/, "")
      gsub(/\r/, "")
      gsub(/^["'\'']|["'\'']$/, "")
      print
      exit
    }
  ' "$file" 2>/dev/null || true
}

if [[ "$YES" -ne 1 ]]; then
  if [[ "$MODE" == "wings" ]]; then
    printf 'This stops Wings and force-deletes Pterodactyl/Pelican Docker containers, networks, and port bindings.\n'
  else
    printf 'This deletes Pterodactyl/Pelican (panel + Wings), Docker game containers, networks, and port bindings.\n'
  fi
  printf 'Docker Engine, nginx, and Flutter are left installed.\n'
  printf 'Type wipe to continue: '
  read -r answer
  [[ "$answer" == "wipe" ]] || die "Aborted."
fi

WINGS_CFG=""
for candidate in /etc/pterodactyl/config.yml /etc/pelican/config.yml; do
  if [[ -f "$candidate" ]]; then
    WINGS_CFG="$candidate"
    break
  fi
done

NETWORK_NAME="pterodactyl_nw"
DATA_DIR="/var/lib/pterodactyl"
if [[ -n "$WINGS_CFG" ]]; then
  parsed_net="$(yaml_value "$WINGS_CFG" name)"
  parsed_data="$(yaml_value "$WINGS_CFG" data)"
  [[ -n "$parsed_net" && "$parsed_net" != *.* ]] && NETWORK_NAME="$parsed_net"
  [[ -n "$parsed_data" && "$parsed_data" == /* ]] && DATA_DIR="$parsed_data"
fi

PANEL_ENV=""
DB_NAME="panel"
DB_USER="pterodactyl"
DB_HOST="127.0.0.1"
for candidate in /var/www/pterodactyl/.env /var/www/pelican/.env; do
  if [[ -f "$candidate" ]]; then
    PANEL_ENV="$candidate"
    break
  fi
done
if [[ -n "$PANEL_ENV" ]]; then
  parsed_name="$(env_value "$PANEL_ENV" DB_DATABASE)"
  parsed_user="$(env_value "$PANEL_ENV" DB_USERNAME)"
  parsed_host="$(env_value "$PANEL_ENV" DB_HOST)"
  [[ -n "$parsed_name" ]] && DB_NAME="$parsed_name"
  [[ -n "$parsed_user" ]] && DB_USER="$parsed_user"
  [[ -n "$parsed_host" ]] && DB_HOST="$parsed_host"
fi

log "Stopping Wings and panel workers"
while IFS= read -r unit; do
  [[ -n "$unit" ]] || continue
  stop_unit "$unit"
done < <(systemctl list-unit-files --no-legend --plain 2>/dev/null | awk '{print $1}' | grep -Ei '^(wings|pteroq|pterodactyl|pelican)([.@].*)?\.service$' || true)

stop_unit wings.service
stop_unit pteroq.service
stop_unit pterodactyl.service
stop_unit pelican-queue.service
stop_unit pelican.service

kill_matching '/usr/local/bin/wings'
kill_matching '/usr/bin/wings'
pgrep -x wings >/dev/null 2>&1 && pkill -9 -x wings 2>/dev/null || true
kill_matching 'artisan queue:work'
kill_matching '/var/www/pterodactyl'
kill_matching '/var/www/pelican'

if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  log "Removing Pterodactyl/Pelican Docker containers (releases game port bindings)"
  ids=""
  ids+=" $(docker ps -aq --filter 'label=Service=pterodactyl' 2>/dev/null || true)"
  ids+=" $(docker ps -aq --filter 'label=Service=pelican' 2>/dev/null || true)"
  ids+=" $(docker ps -aq --filter "network=${NETWORK_NAME}" 2>/dev/null || true)"
  ids+=" $(docker ps -aq --filter 'name=pterodactyl' 2>/dev/null || true)"
  ids+=" $(docker ps -aq --filter 'name=pelican' 2>/dev/null || true)"
  # Unique IDs; skip Flutter containers if a filter overlapped.
  printf '%s\n' $ids | awk 'NF && !seen[$1]++' | while read -r id; do
    [[ -n "$id" ]] || continue
    labels="$(docker inspect -f '{{json .Config.Labels}}' "$id" 2>/dev/null || true)"
    name="$(docker inspect -f '{{.Name}}' "$id" 2>/dev/null || true)"
    if [[ "$labels" == *flutter.server* || "$labels" == *flutter.role* || "$name" == *flutter* ]]; then
      continue
    fi
    docker rm -f "$id" >/dev/null 2>&1 || true
  done

  log "Removing Docker networks ${NETWORK_NAME} / pelican_nw"
  docker network rm "$NETWORK_NAME" 2>/dev/null || true
  docker network rm pelican_nw 2>/dev/null || true
  while read -r net; do
    [[ -n "$net" ]] || continue
    docker network rm "$net" 2>/dev/null || true
  done < <(docker network ls --format '{{.Name}}' 2>/dev/null | grep -Ei 'ptero|pelican' || true)

  if [[ "$KEEP_DATA" -eq 0 ]]; then
    docker volume ls -q 2>/dev/null | grep -Ei 'ptero|pelican' | xargs -r docker volume rm -f 2>/dev/null || true
  fi
elif command -v docker >/dev/null 2>&1; then
  warn "Docker is installed but not running; skipped container cleanup"
fi

if ip link show pterodactyl0 >/dev/null 2>&1; then
  log "Removing leftover bridge pterodactyl0"
  ip link set pterodactyl0 down 2>/dev/null || true
  ip link delete pterodactyl0 2>/dev/null || true
fi

log "Removing Wings binaries and unit files"
rm -f /usr/local/bin/wings /usr/bin/wings
rm -f /etc/systemd/system/wings.service /lib/systemd/system/wings.service
find /etc/systemd/system /lib/systemd/system /usr/lib/systemd/system -maxdepth 1 \
  \( -iname '*ptero*' -o -iname '*wings*' -o -iname '*pelican*' \) \
  ! -iname '*flutter*' \
  -print -delete 2>/dev/null || true

if [[ "$MODE" == "all" ]]; then
  log "Removing nginx / Apache panel sites"
  shopt -s nullglob
  for f in \
    /etc/nginx/sites-enabled/* \
    /etc/nginx/sites-available/* \
    /etc/nginx/conf.d/*.conf \
    /etc/apache2/sites-enabled/* \
    /etc/apache2/sites-available/*
  do
    if grep -qiE 'pterodactyl|/var/www/pterodactyl|/var/www/pelican|\bpelican\b' "$f" 2>/dev/null; then
      log "  ${f}"
      rm -f "$f"
    fi
  done
  shopt -u nullglob
  rm -f /etc/nginx/sites-enabled/pterodactyl.conf /etc/nginx/sites-available/pterodactyl.conf
  rm -f /etc/nginx/sites-enabled/pelican.conf /etc/nginx/sites-available/pelican.conf
  rm -f /etc/php/*/fpm/pool.d/pterodactyl.conf /etc/php/*/fpm/pool.d/pelican.conf

  if command -v nginx >/dev/null 2>&1 && systemctl is-active --quiet nginx 2>/dev/null; then
    nginx -t 2>/dev/null && systemctl reload nginx || warn "nginx reload skipped (config may be invalid until you reinstall)"
  fi
  if command -v apache2ctl >/dev/null 2>&1 && systemctl is-active --quiet apache2 2>/dev/null; then
    apache2ctl configtest 2>/dev/null && systemctl reload apache2 || true
  fi

  if [[ "$WIPE_CERTS" -eq 1 ]] && command -v certbot >/dev/null 2>&1; then
    log "Removing Let's Encrypt certs with ptero/pelican in the name"
    while read -r name; do
      [[ -n "$name" ]] || continue
      certbot delete --cert-name "$name" --non-interactive || true
    done < <(certbot certificates 2>/dev/null | awk '/Certificate Name:/{print $3}' | grep -Ei 'ptero|pelican' || true)
  fi

  log "Removing cron entries"
  rm -f /etc/cron.d/pterodactyl /etc/cron.d/pelican
  for user in root www-data nginx apache; do
    if crontab -u "$user" -l >/tmp/ptero-cron 2>/dev/null; then
      grep -vE 'pterodactyl|/var/www/pterodactyl|/var/www/pelican|pelican/artisan' /tmp/ptero-cron > /tmp/ptero-cron.new || true
      crontab -u "$user" /tmp/ptero-cron.new 2>/dev/null || true
    fi
    rm -f /tmp/ptero-cron /tmp/ptero-cron.new
  done

  rm -f /etc/sudoers.d/pterodactyl /etc/sudoers.d/pelican /etc/sudoers.d/wings
fi

log "Removing install directories"
rm -rf /etc/pterodactyl /etc/pelican
rm -rf /srv/daemon /srv/daemon-data
rm -rf /var/log/pterodactyl /var/log/pelican /tmp/pterodactyl /tmp/pelican
if [[ "$KEEP_DATA" -eq 1 ]]; then
  log "Keeping game data under ${DATA_DIR} / /var/lib/pterodactyl / /var/lib/pelican"
else
  rm -rf /var/lib/pterodactyl /var/lib/pelican
  [[ "$DATA_DIR" == /var/lib/pterodactyl* || "$DATA_DIR" == /var/lib/pelican* ]] || rm -rf "$DATA_DIR"
fi
if [[ "$MODE" == "all" ]]; then
  rm -rf /var/www/pterodactyl /var/www/pelican
fi

if [[ "$MODE" == "all" && "$DROP_DB" -eq 1 ]]; then
  log "Dropping panel database ${DB_NAME} and user ${DB_USER}"
  if command -v mysql >/dev/null 2>&1; then
    mysql -e "DROP DATABASE IF EXISTS \`${DB_NAME}\`;" 2>/dev/null \
      || mysql -u root -e "DROP DATABASE IF EXISTS \`${DB_NAME}\`;" 2>/dev/null \
      || warn "Could not drop database ${DB_NAME} (run it by hand as the MySQL root user)"
    mysql -e "DROP USER IF EXISTS '${DB_USER}'@'${DB_HOST}'; DROP USER IF EXISTS '${DB_USER}'@'localhost'; DROP USER IF EXISTS '${DB_USER}'@'127.0.0.1';" 2>/dev/null || true
  elif command -v mariadb >/dev/null 2>&1; then
    mariadb -e "DROP DATABASE IF EXISTS \`${DB_NAME}\`;" 2>/dev/null || warn "Could not drop database ${DB_NAME}"
    mariadb -e "DROP USER IF EXISTS '${DB_USER}'@'localhost'; DROP USER IF EXISTS '${DB_USER}'@'127.0.0.1';" 2>/dev/null || true
  else
    warn "mysql/mariadb client not found; skipped --drop-db"
  fi
fi

if [[ "$MODE" == "all" && "$PURGE_PHP" -eq 1 ]]; then
  log "Purging PHP and composer packages"
  export DEBIAN_FRONTEND=noninteractive
  apt-get purge -y 'php*' composer 2>/dev/null || true
  apt-get autoremove -y 2>/dev/null || true
  rm -f /usr/local/bin/composer
fi

systemctl daemon-reload 2>/dev/null || true
systemctl reset-failed 2>/dev/null || true

still=""
systemctl is-active --quiet wings 2>/dev/null && still+=" wings"
pgrep -x wings >/dev/null 2>&1 && still+=" wings-process"
if command -v ss >/dev/null 2>&1; then
  ss -tlnp 2>/dev/null | grep -qE ':8080\s' && still+=" :8080"
  ss -tlnp 2>/dev/null | grep -qE ':2022\s' && still+=" :2022"
elif command -v lsof >/dev/null 2>&1; then
  lsof -iTCP:8080 -sTCP:LISTEN >/dev/null 2>&1 && still+=" :8080"
  lsof -iTCP:2022 -sTCP:LISTEN >/dev/null 2>&1 && still+=" :2022"
fi

if [[ -n "$still" ]]; then
  warn "Still bound after wipe:${still}"
  warn "Check: ss -tlnp | grep -E '8080|2022'"
else
  log "Wings port bindings 8080 and 2022 are free"
fi

log "Done. Docker Engine, nginx, and Flutter were left installed."
cat <<EOF

Install or reinstall Flutter on this host with:

  sudo bash install/ubuntu-24.04.sh --yes --url https://YOUR_HOST

Or attach as a game node:

  sudo bash install/ubuntu-node.sh --yes --panel-url https://panel.example.com --token flt_... --node <id> --listen-url http://THIS_IP:8080

If a firewall still allows Wings SFTP and you do not need it:

  sudo ufw delete allow 2022/tcp
EOF
