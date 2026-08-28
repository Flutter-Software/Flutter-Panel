#!/usr/bin/env bash
# Remove a local Flutter panel and/or game-node install so the machine can be
# treated as fresh. Does not uninstall Docker, Node.js, nginx, or cloudflared
# packages (the installer will reuse them).
#
#   sudo bash install/wipe-local.sh --yes
#   sudo bash install/wipe-local.sh --yes --daemon-only
#
# Options:
#   --yes / -y         Do not prompt
#   --daemon-only      Wipe the game-node daemon only (not the panel)
#   --node-only        Same as --daemon-only
#   --prefix DIR       Panel install dir (default /opt/flutter)
#   --node-prefix DIR  Node-only install dir (default /opt/flutter-node)
#   --data-dir DIR     Game data dir (default /var/lib/flutter)
#   --keep-data        Leave the game data directory
#   --keep-user        Leave the flutter system user
#   --wipe-certs       Delete Let's Encrypt certs whose name contains "flutter"
#   --purge-src        Also delete /usr/local/src/flutter-panel (default on full wipe)
#   --keep-src         Leave /usr/local/src/flutter-panel
set -euo pipefail

PREFIX="${FLUTTER_PREFIX:-/opt/flutter}"
NODE_PREFIX="${FLUTTER_NODE_PREFIX:-/opt/flutter-node}"
DATA_DIR="${FLUTTER_DATA_DIR:-/var/lib/flutter}"
SERVICE_USER="${FLUTTER_USER:-flutter}"
TUNNEL_LOG="/var/log/flutter-cloudflared.log"
YES=0
MODE="all"
KEEP_USER=0
KEEP_DATA=0
WIPE_CERTS=0
PURGE_SRC=-1

log() { printf '[flutter-wipe] %s\n' "$*"; }
warn() { printf '[flutter-wipe] warning: %s\n' "$*" >&2; }
die() { printf '[flutter-wipe] error: %s\n' "$*" >&2; exit 1; }

usage() {
  sed -n '2,24p' "$0"
  exit 0
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --yes|-y) YES=1 ;;
    --daemon-only|--node-only) MODE="daemon" ;;
    --prefix) PREFIX="${2:?}"; shift ;;
    --node-prefix) NODE_PREFIX="${2:?}"; shift ;;
    --data-dir) DATA_DIR="${2:?}"; shift ;;
    --keep-data) KEEP_DATA=1 ;;
    --keep-user) KEEP_USER=1 ;;
    --wipe-certs) WIPE_CERTS=1 ;;
    --purge-src) PURGE_SRC=1 ;;
    --keep-src) PURGE_SRC=0 ;;
    --help|-h) usage ;;
    *) die "Unknown option: $1 (see --help)" ;;
  esac
  shift
done

[[ "$(id -u)" -eq 0 ]] || die "Run as root: sudo bash install/wipe-local.sh"

if [[ "$PURGE_SRC" -eq -1 ]]; then
  if [[ "$MODE" == "daemon" ]]; then
    PURGE_SRC=0
  else
    PURGE_SRC=1
  fi
fi

has_panel() {
  [[ -d "$PREFIX/apps/web" || -f /etc/systemd/system/flutter-api.service ]]
}

unit_workdir() {
  local unit="$1"
  systemctl show -p WorkingDirectory --value "$unit" 2>/dev/null || true
}

stop_unit() {
  local unit="$1"
  systemctl disable --now "$unit" 2>/dev/null || true
  systemctl stop "$unit" 2>/dev/null || true
  rm -f "/etc/systemd/system/${unit}" "/lib/systemd/system/${unit}"
  rm -rf "/etc/systemd/system/${unit}.d" "/lib/systemd/system/${unit}.d"
}

kill_matching() {
  local pattern="$1"
  pkill -f "$pattern" 2>/dev/null || true
  sleep 0.2
  pkill -9 -f "$pattern" 2>/dev/null || true
}

if [[ "$YES" -ne 1 ]]; then
  if [[ "$MODE" == "daemon" ]]; then
    printf 'This deletes the Flutter daemon on this machine (%s, tunnel, and %s unless --keep-data).\n' "$NODE_PREFIX" "$DATA_DIR"
  else
    printf 'This deletes the Flutter panel, daemon, Docker game containers, and %s.\n' "$DATA_DIR"
  fi
  printf 'Type wipe to continue: '
  read -r answer
  [[ "$answer" == "wipe" ]] || die "Aborted."
fi

log "Stopping node services"
stop_unit flutter-node-tunnel.service

DAEMON_WD="$(unit_workdir flutter-daemon.service)"
if [[ "$MODE" == "daemon" ]] && has_panel && [[ "$DAEMON_WD" == "$PREFIX"* ]]; then
  warn "Panel is installed here; leaving flutter-daemon.service (it belongs to ${PREFIX})"
else
  stop_unit flutter-daemon.service
fi

kill_matching "${NODE_PREFIX}"
kill_matching "cloudflared tunnel --no-autoupdate --url http://127.0.0.1:"
kill_matching "npm run (start|configure) -w @flutter-software/daemon"

if [[ "$MODE" == "all" ]]; then
  log "Stopping panel services"
  stop_unit flutter-api.service
  stop_unit flutter-web.service
fi

if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  if [[ "$MODE" == "all" && -f "$PREFIX/docker-compose.yml" ]]; then
    log "Stopping panel compose stack"
    (cd "$PREFIX" && docker compose down -v --remove-orphans) 2>/dev/null || true
  fi
  log "Removing Flutter game containers"
  docker ps -aq --filter "name=flutter" | xargs -r docker rm -f 2>/dev/null || true
  docker ps -aq --filter "label=flutter.server" | xargs -r docker rm -f 2>/dev/null || true
  docker ps -aq --filter "label=flutter.role" | xargs -r docker rm -f 2>/dev/null || true
  if [[ "$MODE" == "all" || "$KEEP_DATA" -eq 0 ]]; then
    docker volume ls -q | grep -E 'flutter' | xargs -r docker volume rm -f 2>/dev/null || true
  fi
elif command -v docker >/dev/null 2>&1; then
  warn "Docker is installed but not running; skipped container cleanup"
fi

if [[ "$MODE" == "all" ]]; then
  log "Removing nginx Flutter site"
  rm -f /etc/nginx/sites-enabled/flutter /etc/nginx/sites-available/flutter
  rm -f /etc/nginx/conf.d/flutter-upgrade.conf /etc/nginx/conf.d/flutter-upgrade-map.conf
  if command -v nginx >/dev/null 2>&1 && systemctl is-active --quiet nginx 2>/dev/null; then
    nginx -t 2>/dev/null && systemctl reload nginx || warn "nginx reload skipped (config may be invalid until you reinstall)"
  fi

  if [[ "$WIPE_CERTS" -eq 1 ]] && command -v certbot >/dev/null 2>&1; then
    log "Removing Let's Encrypt certs with 'flutter' in the name"
    certbot certificates 2>/dev/null | awk '/Certificate Name:/{print $3}' | grep -i flutter | while read -r name; do
      certbot delete --cert-name "$name" --non-interactive || true
    done
  fi
fi

log "Removing helpers"
rm -f /usr/local/sbin/flutter-node-configure
rm -f "$TUNNEL_LOG"
if [[ "$MODE" == "all" ]]; then
  rm -f /usr/local/sbin/flutter-restart /usr/local/sbin/flutter-update
  rm -f /etc/sudoers.d/flutter-panel
fi
systemctl daemon-reload 2>/dev/null || true
systemctl reset-failed 2>/dev/null || true

log "Removing install directories"
rm -rf "$NODE_PREFIX"
if [[ "$KEEP_DATA" -eq 1 ]]; then
  log "Keeping game data at ${DATA_DIR}"
elif [[ "$MODE" == "daemon" ]] && has_panel; then
  warn "Panel is installed here; leaving ${DATA_DIR} (pass --data-dir only if you meant to wipe it)"
else
  rm -rf "$DATA_DIR"
fi
if [[ "$MODE" == "all" ]]; then
  rm -rf "$PREFIX"
fi
if [[ "$PURGE_SRC" -eq 1 ]]; then
  rm -rf /usr/local/src/flutter-panel
fi

if [[ "$KEEP_USER" -eq 0 ]] && id -u "$SERVICE_USER" >/dev/null 2>&1; then
  if [[ "$MODE" == "daemon" ]] && has_panel; then
    warn "Leaving user ${SERVICE_USER} because the panel is still installed"
  else
    log "Removing user ${SERVICE_USER}"
    userdel "$SERVICE_USER" 2>/dev/null || userdel --remove "$SERVICE_USER" 2>/dev/null || warn "Could not delete user ${SERVICE_USER}"
  fi
fi

if [[ "$MODE" == "daemon" ]]; then
  log "Done. This host no longer has a Flutter game-node daemon."
  log "Docker and Node.js packages were left installed."
  cat <<EOF

Attach this machine as a node again with:

  sudo bash install/connect-home-node.sh --panel-url https://panel.flutter.software --token flt_... --node <id>

Or, if it has a public IP:

  sudo bash install/ubuntu-node.sh --yes --panel-url https://panel.example.com --token flt_... --node <id> --listen-url http://THIS_IP:8080
EOF
else
  log "Done. This host looks like a fresh machine for install/ubuntu-24.04.sh"
  log "Docker, Node.js, and nginx packages were left installed."
  cat <<EOF

Reinstall the panel with:

  sudo bash install/ubuntu-24.04.sh --yes --url https://YOUR_HOST

Or attach as a node-only host:

  sudo bash install/connect-home-node.sh --panel-url https://panel.flutter.software --token flt_... --node <id>
EOF
fi
