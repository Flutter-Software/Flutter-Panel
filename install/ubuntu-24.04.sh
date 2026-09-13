#!/usr/bin/env bash
# Flutter panel installer for Ubuntu 24.04.
#
# Usage (from the repo):
#   sudo bash install/ubuntu-24.04.sh
#
# Non-interactive:
#   sudo FLUTTER_URL=https://panel.example.com FLUTTER_EMAIL=you@example.com \
#     FLUTTER_LETSENCRYPT=1 bash install/ubuntu-24.04.sh --yes
#
# Options:
#   --yes                 Use defaults / env vars, do not prompt
#   --url URL             Public panel URL (http://IP or https://hostname)
#   --email EMAIL         Email for Let's Encrypt
#   --letsencrypt         Request a Let's Encrypt certificate (https URL + hostname)
#   --no-nginx            Skip nginx reverse proxy
#   --no-daemon           Skip installing the local game-node daemon
#   --admin-email EMAIL   Admin account email
#   --admin-password PW   Admin account password
#   --admin-username NAME Admin username (default Administrator)
#   --from-pterodactyl    This host is switching from Pterodactyl/Pelican
#   --migrate-servers     Import eggs and recreate servers (requires local daemon)
#   --wipe-pterodactyl    Remove Pterodactyl/Pelican after dumping data
#   --force               Continue on a distro that is not Ubuntu 24.04
#   --prefix DIR          Install directory (default /opt/flutter)
#
# Remote game nodes: run install/ubuntu-node.sh on those hosts (no panel).
# Wipe a test install: sudo bash install/wipe-local.sh --yes
set -euo pipefail

FLUTTER_REPO="${FLUTTER_REPO:-https://github.com/Flutter-Software/Flutter-Panel.git}"
PREFIX="${FLUTTER_PREFIX:-/opt/flutter}"
DATA_DIR="${FLUTTER_DATA_DIR:-/var/lib/flutter}"
SERVICE_USER="${FLUTTER_USER:-flutter}"
NODE_MAJOR=22

YES=0
FORCE=0
INSTALL_NGINX=1
INSTALL_DAEMON=1
LETSENCRYPT=0
FROM_PTERO=0
MIGRATE_SERVERS=0
WIPE_PTERO=0
APP_URL="${FLUTTER_URL:-}"
LE_EMAIL="${FLUTTER_EMAIL:-}"
ADMIN_EMAIL="${FLUTTER_ADMIN_EMAIL:-}"
ADMIN_PASSWORD="${FLUTTER_ADMIN_PASSWORD:-}"
ADMIN_USERNAME="${FLUTTER_ADMIN_USERNAME:-Administrator}"
ADMIN_GENERATED=0
ADMIN_CREATED=0
PTERO_DUMP=""
MIGRATED_EGGS=0
MIGRATED_SERVERS=0
SKIPPED_REMOTE=0
COPIED_VOLUMES=0

if [[ "${FLUTTER_LETSENCRYPT:-}" == "1" ]]; then
  LETSENCRYPT=1
fi
if [[ "${FLUTTER_NO_NGINX:-}" == "1" ]]; then
  INSTALL_NGINX=0
fi
if [[ "${FLUTTER_NO_DAEMON:-}" == "1" ]]; then
  INSTALL_DAEMON=0
fi
if [[ "${FLUTTER_FROM_PTERODACTYL:-}" == "1" ]]; then
  FROM_PTERO=1
fi
if [[ "${FLUTTER_MIGRATE_SERVERS:-}" == "1" ]]; then
  FROM_PTERO=1
  MIGRATE_SERVERS=1
fi
if [[ "${FLUTTER_WIPE_PTERODACTYL:-}" == "1" ]]; then
  FROM_PTERO=1
  WIPE_PTERO=1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
# shellcheck source=lib/ui.sh
source "$SCRIPT_DIR/lib/ui.sh"

usage() {
  sed -n '2,32p' "$0"
  exit 0
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --yes|-y) YES=1 ;;
    --force) FORCE=1 ;;
    --no-nginx) INSTALL_NGINX=0 ;;
    --no-daemon) INSTALL_DAEMON=0 ;;
    --letsencrypt) LETSENCRYPT=1 ;;
    --from-pterodactyl) FROM_PTERO=1 ;;
    --migrate-servers) FROM_PTERO=1; MIGRATE_SERVERS=1 ;;
    --wipe-pterodactyl) FROM_PTERO=1; WIPE_PTERO=1 ;;
    --url) APP_URL="${2:?}"; shift ;;
    --email) LE_EMAIL="${2:?}"; shift ;;
    --admin-email) ADMIN_EMAIL="${2:?}"; shift ;;
    --admin-password) ADMIN_PASSWORD="${2:?}"; shift ;;
    --admin-username) ADMIN_USERNAME="${2:?}"; shift ;;
    --prefix) PREFIX="${2:?}"; shift ;;
    --help|-h) usage ;;
    *) die "Unknown option: $1 (see --help)" ;;
  esac
  shift
done

[[ "$(id -u)" -eq 0 ]] || die "Run as root: sudo bash install/ubuntu-24.04.sh"

SOURCE=""
if [[ -f "$REPO_ROOT/package.json" ]] && grep -q '"name": "flutter-panel"' "$REPO_ROOT/package.json"; then
  SOURCE="$REPO_ROOT"
fi

if [[ -f /etc/os-release ]]; then
  # shellcheck disable=SC1091
  . /etc/os-release
else
  die "Cannot read /etc/os-release"
fi

PUBLIC_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
PUBLIC_IP="${PUBLIC_IP:-127.0.0.1}"
URL_SCHEME=""
URL_HOST=""
IS_IP=0
COOKIE_SECURE=false

detect_ptero() {
  [[ -d /etc/pterodactyl || -d /var/www/pterodactyl || -d /etc/pelican || -d /var/www/pelican ]] && return 0
  [[ -x /usr/local/bin/wings || -x /usr/bin/wings ]] && return 0
  systemctl is-active --quiet wings 2>/dev/null && return 0
  pgrep -x wings >/dev/null 2>&1 && return 0
  return 1
}

wings_running() {
  systemctl is-active --quiet wings 2>/dev/null || pgrep -x wings >/dev/null 2>&1
}

parse_app_url() {
  if [[ "$APP_URL" != http://* && "$APP_URL" != https://* ]]; then
    APP_URL="http://${APP_URL}"
  fi
  APP_URL="${APP_URL%/}"
  URL_SCHEME="${APP_URL%%://*}"
  URL_HOST="${APP_URL#*://}"
  URL_HOST="${URL_HOST%%/*}"
  URL_HOST="${URL_HOST%%:*}"
  [[ -n "$URL_HOST" ]] || die "Could not parse hostname from $APP_URL"
  IS_IP=0
  if [[ "$URL_HOST" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]]; then
    IS_IP=1
  fi
  COOKIE_SECURE=false
  if [[ "$URL_SCHEME" == "https" ]]; then
    COOKIE_SECURE=true
  fi
}

valid_email() {
  [[ "$1" =~ ^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$ ]]
}

username_from_email() {
  local local_part="${1%%@*}"
  local_part="$(printf '%s' "$local_part" | tr -cd 'A-Za-z0-9_')"
  if [[ ${#local_part} -ge 3 && ${#local_part} -le 32 ]]; then
    printf '%s\n' "$local_part"
  else
    printf 'Administrator\n'
  fi
}

generate_password() {
  if command -v python3 >/dev/null 2>&1; then
    python3 -c 'import secrets,string; alphabet=string.ascii_letters+string.digits; print("".join(secrets.choice(alphabet) for _ in range(20)))'
    return
  fi
  local pw
  pw="$(openssl rand -hex 16)"
  printf '%s\n' "${pw:0:20}"
}

default_admin_email() {
  if [[ "$IS_IP" -eq 1 ]]; then
    printf 'admin@flutter.local\n'
  else
    printf 'admin@%s\n' "$URL_HOST"
  fi
}

apply_letsencrypt_rules() {
  if [[ "$LETSENCRYPT" -eq 1 ]]; then
    [[ "$INSTALL_NGINX" -eq 1 ]] || die "Let's Encrypt requires nginx"
    [[ "$IS_IP" -eq 0 ]] || die "Let's Encrypt needs a hostname, not an IP address"
    [[ -n "$LE_EMAIL" ]] || die "An email address is required for Let's Encrypt"
    if [[ "$URL_SCHEME" != "https" ]]; then
      APP_URL="https://${URL_HOST}"
      URL_SCHEME=https
      COOKIE_SECURE=true
    fi
  fi
}

prepare_admin_account() {
  if [[ -z "$ADMIN_EMAIL" ]]; then
    ADMIN_EMAIL="$(default_admin_email)"
    ADMIN_USERNAME="${ADMIN_USERNAME:-Administrator}"
  fi
  if [[ -z "$ADMIN_PASSWORD" ]]; then
    ADMIN_PASSWORD="$(generate_password)"
    ADMIN_GENERATED=1
  fi
  if [[ ${#ADMIN_PASSWORD} -lt 10 ]]; then
    die "Admin password must be at least 10 characters"
  fi
  if [[ "$ADMIN_GENERATED" -eq 0 && "$ADMIN_USERNAME" == "Administrator" ]]; then
    ADMIN_USERNAME="$(username_from_email "$ADMIN_EMAIL")"
  fi
  valid_email "$ADMIN_EMAIL" || die "Admin email is not valid: $ADMIN_EMAIL"
}

run_wizard() {
  ensure_gum || true
  printf '\n'
  ui_banner_flutter
  if ui_gum_ready; then
    ui_gum style --foreground "#F9FAFB" --bold --align center --padding "1 2" --border double --border-foreground 196 \
      "FLUTTER installer"$'\n'"Arrow keys to move · enter to confirm"
  else
    log "FLUTTER installer — arrow keys to move, enter to confirm"
  fi

  local ptero_default="No"
  if detect_ptero; then
    ptero_default="Yes"
  fi
  local answer
  answer="$(ui_choose "Are you switching from Pterodactyl or Pelican?" "$ptero_default" "Yes" "No")"
  if [[ "$answer" == "Yes" ]]; then
    FROM_PTERO=1
    if [[ "$ptero_default" != "Yes" ]]; then
      warn "No Pterodactyl/Pelican install was detected on this host."
    fi
    answer="$(ui_choose "Transfer servers, eggs, and world files to Flutter?" "Yes" "Yes" "No")"
    if [[ "$answer" == "Yes" ]]; then
      MIGRATE_SERVERS=1
    fi
    answer="$(ui_choose "Wipe Pterodactyl/Pelican from this host? This deletes the PHP panel, Wings, game containers, and the MySQL database." "Yes" "Yes" "No")"
    if [[ "$answer" == "Yes" ]]; then
      WIPE_PTERO=1
    fi
  else
    FROM_PTERO=0
    MIGRATE_SERVERS=0
    WIPE_PTERO=0
  fi

  APP_URL="$(ui_input "What will be the panel URL?" "https://panel.example.com" "${APP_URL:-http://${PUBLIC_IP}}")"
  [[ -n "$APP_URL" ]] || die "Panel URL is required"
  parse_app_url

  if ui_confirm "Install nginx as a reverse proxy in front of the panel?" "Yes"; then
    INSTALL_NGINX=1
  else
    INSTALL_NGINX=0
    LETSENCRYPT=0
  fi

  if [[ "$INSTALL_NGINX" -eq 1 && "$IS_IP" -eq 0 ]]; then
    local le_default="No"
    if [[ "$URL_SCHEME" == "https" || "$LETSENCRYPT" -eq 1 ]]; then
      le_default="Yes"
    fi
    if ui_confirm "Issue a Let's Encrypt certificate for ${URL_HOST}?" "$le_default"; then
      LETSENCRYPT=1
      LE_EMAIL="$(ui_input "Email for Let's Encrypt" "you@example.com" "$LE_EMAIL")"
    else
      LETSENCRYPT=0
    fi
  fi

  local daemon_default="Yes"
  if [[ "$INSTALL_DAEMON" -eq 0 ]]; then
    daemon_default="No"
  fi
  if ui_confirm "Install the game-node daemon on this machine?" "$daemon_default"; then
    INSTALL_DAEMON=1
  else
    INSTALL_DAEMON=0
    if [[ "$MIGRATE_SERVERS" -eq 1 ]]; then
      warn "Server transfer needs the local daemon. Eggs can still be imported; servers will be skipped."
    fi
  fi

  if ui_confirm "Do you want to initialize a personal admin account (or keep the default Administrator account)?" "No"; then
    ADMIN_EMAIL="$(ui_input "Admin email" "you@example.com" "$ADMIN_EMAIL")"
    valid_email "$ADMIN_EMAIL" || die "That email address is not valid"
    ADMIN_USERNAME="$(username_from_email "$ADMIN_EMAIL")"
    while true; do
      ADMIN_PASSWORD="$(ui_password "Admin password (at least 10 characters)")"
      if [[ ${#ADMIN_PASSWORD} -ge 10 ]]; then
        break
      fi
      warn "Password must be at least 10 characters."
    done
    ADMIN_GENERATED=0
  else
    ADMIN_EMAIL=""
    ADMIN_PASSWORD=""
    ADMIN_USERNAME="Administrator"
    ADMIN_GENERATED=1
  fi

  apply_letsencrypt_rules
  prepare_admin_account

  local nginx_label="No" daemon_label="No" le_label="No" ptero_label="No" transfer_label="No" wipe_label="No" admin_label
  [[ "$INSTALL_NGINX" -eq 1 ]] && nginx_label="Yes"
  [[ "$INSTALL_DAEMON" -eq 1 ]] && daemon_label="Yes"
  [[ "$LETSENCRYPT" -eq 1 ]] && le_label="Yes"
  [[ "$FROM_PTERO" -eq 1 ]] && ptero_label="Yes"
  [[ "$MIGRATE_SERVERS" -eq 1 ]] && transfer_label="Yes"
  [[ "$WIPE_PTERO" -eq 1 ]] && wipe_label="Yes"
  if [[ "$ADMIN_GENERATED" -eq 1 ]]; then
    admin_label="${ADMIN_USERNAME} <${ADMIN_EMAIL}> (password shown at the end)"
  else
    admin_label="${ADMIN_USERNAME} <${ADMIN_EMAIL}> (your password)"
  fi

  printf '\n'
  ui_kv_table \
    "Panel URL" "$APP_URL" \
    "Nginx" "$nginx_label" \
    "Let's Encrypt" "$le_label" \
    "Local daemon" "$daemon_label" \
    "From Pterodactyl/Pelican" "$ptero_label" \
    "Transfer servers" "$transfer_label" \
    "Wipe Pterodactyl/Pelican" "$wipe_label" \
    "Admin" "$admin_label" \
    "Install dir" "$PREFIX"

  ui_confirm "Start installation with these settings?" "Yes" || die "Aborted."
}

if [[ "${ID:-}" != "ubuntu" || "${VERSION_ID:-}" != "24.04" ]]; then
  warn "This installer targets Ubuntu 24.04. Detected ${PRETTY_NAME:-unknown}."
  if [[ "$FORCE" -ne 1 ]]; then
    if [[ "$YES" -eq 1 ]]; then
      die "Aborted. Re-run with --force to skip this check."
    fi
    ensure_gum || true
    ui_confirm "Continue anyway?" "No" || die "Aborted. Re-run with --force to skip this check."
  fi
fi

if [[ "$YES" -eq 1 ]]; then
  [[ -n "$APP_URL" ]] || APP_URL="http://${PUBLIC_IP}"
  parse_app_url
  apply_letsencrypt_rules
  prepare_admin_account
else
  run_wizard
fi

if [[ "$MIGRATE_SERVERS" -eq 1 && "$INSTALL_DAEMON" -eq 0 ]]; then
  warn "Skipping egg/server transfer because the local daemon is not being installed."
  MIGRATE_SERVERS=0
fi

if [[ "$FROM_PTERO" -eq 0 ]] && wings_running && [[ "$INSTALL_DAEMON" -eq 1 ]]; then
  die "Pterodactyl Wings is running (it binds :8080). Re-run and choose to switch from Pterodactyl/Pelican, or: sudo bash ${SCRIPT_DIR}/wipe-pterodactyl.sh --yes"
fi

export DEBIAN_FRONTEND=noninteractive

copy_ptero_volumes() {
  local src="" dest="$DATA_DIR/servers" dir uuid volume_root=""
  if [[ -f "$PTERO_DUMP" ]]; then
    volume_root="$(awk -F'"' '/"volumeRoot"/{print $4; exit}' "$PTERO_DUMP")"
  fi
  local candidate
  for candidate in \
    "$volume_root" \
    "${volume_root%/}/volumes" \
    /var/lib/pterodactyl/volumes \
    /var/lib/pelican/volumes
  do
    [[ -n "$candidate" && -d "$candidate" ]] || continue
    src="$candidate"
    break
  done
  if [[ -z "$src" ]]; then
    warn "No Pterodactyl/Pelican volume directory found; servers will be empty."
    return 0
  fi
  mkdir -p "$dest"
  COPIED_VOLUMES=0
  for dir in "$src"/*; do
    [[ -d "$dir" ]] || continue
    uuid="$(basename "$dir")"
    [[ "$uuid" =~ ^[0-9a-fA-F-]{8,}$ ]] || continue
    log "Copying ${uuid}"
    mkdir -p "$dest/$uuid"
    rsync -a "$dir/" "$dest/$uuid/"
    mkdir -p "$dest/$uuid/.flutter"
    printf '{"status":"ok","startedAt":"%s","finishedAt":"%s"}\n' \
      "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
      "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
      >"$dest/$uuid/.flutter/install-status.json"
    COPIED_VOLUMES=$((COPIED_VOLUMES + 1))
  done
  ok "Copied ${COPIED_VOLUMES} server volume(s) to ${dest}"
}

if [[ "$MIGRATE_SERVERS" -eq 1 ]]; then
  ui_phase "EXPORTING PTERODACTYL DATA...."
  apt-get update -y
  apt-get install -y --no-install-recommends ca-certificates rsync
  apt-get install -y --no-install-recommends mariadb-client || apt-get install -y --no-install-recommends mysql-client || true
  PANEL_ENV=""
  for candidate in /var/www/pterodactyl/.env /var/www/pelican/.env; do
    if [[ -f "$candidate" ]]; then
      PANEL_ENV="$candidate"
      break
    fi
  done
  [[ -n "$PANEL_ENV" ]] || die "Could not find a Pterodactyl/Pelican .env to read the database credentials"
  WINGS_CFG=""
  for candidate in /etc/pterodactyl/config.yml /etc/pelican/config.yml; do
    if [[ -f "$candidate" ]]; then
      WINGS_CFG="$candidate"
      break
    fi
  done
  PTERO_DUMP="/root/flutter-ptero-export.json"
  bash "$SCRIPT_DIR/dump-pterodactyl.sh" --env "$PANEL_ENV" --out "$PTERO_DUMP" ${WINGS_CFG:+--wings-config "$WINGS_CFG"}
  chmod 600 "$PTERO_DUMP"
  ok "Wrote ${PTERO_DUMP}"
  ui_phase "COPYING SERVER FILES...."
  if wings_running || [[ -d /etc/pterodactyl || -d /etc/pelican || -x /usr/local/bin/wings ]]; then
    log "Stopping Wings so server files can be copied cleanly"
    bash "$SCRIPT_DIR/wipe-pterodactyl.sh" --yes --wings-only --keep-data
  fi
  copy_ptero_volumes
fi

if [[ "$WIPE_PTERO" -eq 1 ]]; then
  ui_phase "WIPING PTERODACTYL / PELICAN...."
  bash "$SCRIPT_DIR/wipe-pterodactyl.sh" --yes --drop-db
elif [[ "$INSTALL_DAEMON" -eq 1 ]] && { wings_running || [[ -d /etc/pterodactyl || -d /etc/pelican || -x /usr/local/bin/wings ]]; }; then
  ui_phase "STOPPING WINGS...."
  log "Stopping Wings so Flutter can use port 8080"
  bash "$SCRIPT_DIR/wipe-pterodactyl.sh" --yes --wings-only --keep-data
fi

ui_phase "INSTALLING DEPENDENCIES...."
apt-get update -y
apt-get install -y --no-install-recommends \
  ca-certificates curl gnupg git rsync tar unzip \
  python3 openssl ufw \
  build-essential python3-minimal

if [[ "$INSTALL_NGINX" -eq 1 ]]; then
  apt-get install -y --no-install-recommends nginx
  if [[ "$LETSENCRYPT" -eq 1 ]]; then
    apt-get install -y --no-install-recommends certbot python3-certbot-nginx
  fi
fi

install_docker_apt_repo() {
  install -m 0755 -d /etc/apt/keyrings
  if [[ ! -f /etc/apt/keyrings/docker.asc ]]; then
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
    chmod a+r /etc/apt/keyrings/docker.asc
  fi
  local codename
  codename="$(. /etc/os-release && echo "${UBUNTU_CODENAME:-$VERSION_CODENAME}")"
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${codename} stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -y
}

install_compose_binary() {
  local arch gharch dest
  arch="$(dpkg --print-architecture)"
  case "$arch" in
    amd64) gharch=x86_64 ;;
    arm64) gharch=aarch64 ;;
    *) die "Unsupported CPU architecture: ${arch}" ;;
  esac
  dest=/usr/local/lib/docker/cli-plugins/docker-compose
  log "Installing Docker Compose from GitHub (${gharch})"
  mkdir -p "$(dirname "$dest")" /usr/libexec/docker/cli-plugins
  curl -fsSL "https://github.com/docker/compose/releases/latest/download/docker-compose-linux-${gharch}" -o "$dest"
  chmod +x "$dest"
  ln -sfn "$dest" /usr/libexec/docker/cli-plugins/docker-compose
}

ui_phase "INSTALLING DOCKER...."
if ! command -v docker >/dev/null 2>&1; then
  log "Installing Docker Engine"
  if ! curl -fsSL https://get.docker.com | sh; then
    warn "get.docker.com failed; using the Docker apt repository"
    install_docker_apt_repo
    apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  fi
fi

if ! docker compose version >/dev/null 2>&1; then
  log "Installing Docker Compose plugin"
  set +e
  install_docker_apt_repo
  apt-get install -y docker-compose-plugin
  set -e
  if ! docker compose version >/dev/null 2>&1; then
    warn "docker-compose-plugin is not in apt; downloading Compose v2"
    install_compose_binary
  fi
fi
docker compose version >/dev/null 2>&1 || die "Docker Compose v2 is not available"
systemctl enable --now docker

ui_phase "INSTALLING NODE.JS...."
if ! command -v node >/dev/null 2>&1 || [[ "$(node -p 'process.versions.node.split(".")[0]')" -lt "$NODE_MAJOR" ]]; then
  log "Installing Node.js ${NODE_MAJOR}"
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
  apt-get install -y nodejs
fi
log "Node $(node -v), npm $(npm -v), Docker $(docker version --format '{{.Server.Version}}' 2>/dev/null || echo unknown)"

if ! id -u "$SERVICE_USER" >/dev/null 2>&1; then
  useradd --system --home "$PREFIX" --shell /usr/sbin/nologin "$SERVICE_USER"
fi
usermod -aG docker "$SERVICE_USER"

mkdir -p "$PREFIX" "$DATA_DIR" /usr/local/src
chown -R "$SERVICE_USER:$SERVICE_USER" "$DATA_DIR"

ui_phase "INSTALLING PANEL...."
if [[ -z "$SOURCE" ]]; then
  log "Cloning ${FLUTTER_REPO}"
  SOURCE="/usr/local/src/flutter-panel"
  if [[ -d "$SOURCE/.git" ]]; then
    git -C "$SOURCE" fetch --depth 1 origin
    git -C "$SOURCE" reset --hard origin/HEAD
  else
    rm -rf "$SOURCE"
    git clone --depth 1 "$FLUTTER_REPO" "$SOURCE"
  fi
fi

log "Copying application files"
if [[ "$(readlink -f "$SOURCE")" == "$(readlink -f "$PREFIX")" ]]; then
  log "Installing in place at ${PREFIX}"
else
  rsync -a \
    --delete \
    --exclude 'node_modules/' \
    --exclude '.next/' \
    --exclude 'apps/web/.next/' \
    --exclude 'apps/daemon/data/' \
    --exclude '.env' \
    --exclude 'apps/web/.env.local' \
    --exclude '.flutter-update.json' \
    --exclude '*.zip' \
    "$SOURCE/" "$PREFIX/"
fi

mkdir -p "$PREFIX/apps/daemon/data"
chown -R "$SERVICE_USER:$SERVICE_USER" "$PREFIX"

ENV_FILE="$PREFIX/.env"
DATABASE_URL="mongodb://127.0.0.1:27017/flutter?replicaSet=rs0"
REDIS_URL="redis://127.0.0.1:6379"
if [[ ! -f "$ENV_FILE" ]]; then
  log "Writing ${ENV_FILE}"
  SESSION_SECRET="$(python3 -c 'import secrets; print(secrets.token_urlsafe(48))')"
  DAEMON_REQUEST_SECRET="$(python3 -c 'import secrets; print(secrets.token_urlsafe(48))')"
  cat > "$ENV_FILE" <<EOF
NODE_ENV=production
APP_URL=${APP_URL}
API_INTERNAL_URL=http://127.0.0.1:4000
API_WS_URL=ws://127.0.0.1:4000
PORT=4000
HOST=127.0.0.1
DATABASE_URL=${DATABASE_URL}
REDIS_URL=${REDIS_URL}
SESSION_SECRET=${SESSION_SECRET}
DAEMON_REQUEST_SECRET=${DAEMON_REQUEST_SECRET}
COOKIE_SECURE=${COOKIE_SECURE}
DAEMON_PORT=8080
DAEMON_CONFIG=${PREFIX}/apps/daemon/data/config.json
DAEMON_DATA_DIR=${DATA_DIR}
EOF
  chown "$SERVICE_USER:$SERVICE_USER" "$ENV_FILE"
  chmod 640 "$ENV_FILE"
else
  log "Keeping existing ${ENV_FILE}"
  sed -i "s|^APP_URL=.*|APP_URL=${APP_URL}|" "$ENV_FILE"
  sed -i "s|^COOKIE_SECURE=.*|COOKIE_SECURE=${COOKIE_SECURE}|" "$ENV_FILE"
  grep -q '^HOST=' "$ENV_FILE" || echo 'HOST=127.0.0.1' >> "$ENV_FILE"
  grep -q '^DAEMON_DATA_DIR=' "$ENV_FILE" || echo "DAEMON_DATA_DIR=${DATA_DIR}" >> "$ENV_FILE"
  grep -q '^DAEMON_CONFIG=' "$ENV_FILE" || echo "DAEMON_CONFIG=${PREFIX}/apps/daemon/data/config.json" >> "$ENV_FILE"
  DATABASE_URL="$(awk -F= '$1=="DATABASE_URL"{sub(/^[^=]+=/,""); print; exit}' "$ENV_FILE")"
  REDIS_URL="$(awk -F= '$1=="REDIS_URL"{sub(/^[^=]+=/,""); print; exit}' "$ENV_FILE")"
fi

cat > "$PREFIX/apps/web/.env.local" <<EOF
API_INTERNAL_URL=http://127.0.0.1:4000
APP_URL=${APP_URL}
EOF
chown "$SERVICE_USER:$SERVICE_USER" "$PREFIX/apps/web/.env.local"

as_flutter() {
  runuser -u "$SERVICE_USER" -- "$@"
}

as_flutter_docker() {
  runuser -u "$SERVICE_USER" -- sg docker -c "$*"
}

log "Installing npm packages"
as_flutter bash -lc "cd $(printf '%q' "$PREFIX") && npm ci"

ui_phase "INSTALLING DATABASE...."
log "Starting MongoDB and Redis"
as_flutter_docker "cd $(printf '%q' "$PREFIX") && docker compose up -d"

log "Waiting for MongoDB replica set"
mongo_ready=0
for _ in $(seq 1 90); do
  mongo_health="$(as_flutter_docker "cd $(printf '%q' "$PREFIX") && docker compose ps --format '{{.Health}}' mongo" | tail -n1 | tr -d '\r')"
  if [[ "$mongo_health" == "healthy" ]]; then
    mongo_ready=1
    break
  fi
  sleep 2
done
[[ "$mongo_ready" -eq 1 ]] || die "MongoDB replica set did not become ready"

log "Applying database schema"
as_flutter bash -lc "cd $(printf '%q' "$PREFIX") && npm run db:push"

log "Building the panel"
as_flutter bash -lc "cd $(printf '%q' "$PREFIX") && API_INTERNAL_URL=http://127.0.0.1:4000 npm run build -w @flutter-software/web"

if [[ "$INSTALL_DAEMON" -eq 1 ]]; then
  ui_phase "INSTALLING NODE DAEMON...."
  as_flutter bash -lc "cd $(printf '%q' "$PREFIX") && node scripts/ensure-daemon.mjs"
fi

install -m 644 "$PREFIX/install/systemd/flutter-api.service" /etc/systemd/system/flutter-api.service
install -m 644 "$PREFIX/install/systemd/flutter-web.service" /etc/systemd/system/flutter-web.service
if [[ "$INSTALL_DAEMON" -eq 1 ]]; then
  install -m 644 "$PREFIX/install/systemd/flutter-daemon.service" /etc/systemd/system/flutter-daemon.service
fi

if [[ "$PREFIX" != "/opt/flutter" ]]; then
  sed -i "s|/opt/flutter|${PREFIX}|g" /etc/systemd/system/flutter-api.service /etc/systemd/system/flutter-web.service
  if [[ -f /etc/systemd/system/flutter-daemon.service ]]; then
    sed -i "s|/opt/flutter|${PREFIX}|g" /etc/systemd/system/flutter-daemon.service
  fi
fi
if [[ "$DATA_DIR" != "/var/lib/flutter" && -f /etc/systemd/system/flutter-daemon.service ]]; then
  sed -i "s|/var/lib/flutter|${DATA_DIR}|g" /etc/systemd/system/flutter-daemon.service
fi

if [[ "$INSTALL_NGINX" -eq 1 ]]; then
  sed -i 's|^ExecStart=.*|ExecStart=/usr/bin/npm exec --workspace=@flutter-software/web -- next start --hostname 127.0.0.1 --port 3010|' \
    /etc/systemd/system/flutter-web.service
fi

systemctl daemon-reload
systemctl enable --now flutter-api.service flutter-web.service
if [[ "$INSTALL_DAEMON" -eq 1 ]]; then
  systemctl enable --now flutter-daemon.service
fi

install -m 755 "$PREFIX/install/systemd/flutter-restart" /usr/local/sbin/flutter-restart
install -m 755 "$PREFIX/install/systemd/flutter-update" /usr/local/sbin/flutter-update
sed -i "s|/opt/flutter|${PREFIX}|g" /usr/local/sbin/flutter-update
sed -i "s/^USER_NAME=.*/USER_NAME=${SERVICE_USER}/" /usr/local/sbin/flutter-update
printf '%s ALL=(root) NOPASSWD: /usr/local/sbin/flutter-restart, /usr/local/sbin/flutter-update\n' "$SERVICE_USER" > /etc/sudoers.d/flutter-panel
chmod 440 /etc/sudoers.d/flutter-panel
visudo -cf /etc/sudoers.d/flutter-panel >/dev/null

start_nginx() {
  systemctl enable nginx >/dev/null
  if systemctl restart nginx; then
    return 0
  fi
  fail "nginx.service failed to start. Recent logs:"
  journalctl -u nginx.service -n 40 --no-pager || true
  warn "Listeners on :80 / :443:"
  ss -tlnp 2>/dev/null | grep -E ':80|:443' || true
  warn "Enabled sites:"
  ls -la /etc/nginx/sites-enabled/ || true
  die "nginx failed to start. Fix the error above, then re-run: systemctl restart nginx"
}

if [[ "$INSTALL_NGINX" -eq 1 ]]; then
  ui_phase "CONFIGURING NGINX...."
  install -m 644 "$PREFIX/install/nginx/upgrade-map.conf" /etc/nginx/conf.d/flutter-upgrade.conf
  sed "s/__SERVER_NAME__/${URL_HOST}/g" "$PREFIX/install/nginx/flutter.conf" > /etc/nginx/sites-available/flutter
  if [[ ! -s /proc/net/if_inet6 ]]; then
    sed -i '/listen \[::\]:80;/d' /etc/nginx/sites-available/flutter
  fi
  ln -sfn /etc/nginx/sites-available/flutter /etc/nginx/sites-enabled/flutter
  rm -f /etc/nginx/sites-enabled/default

  if grep -R --include='*.conf' -l "server_name[[:space:]].*${URL_HOST}" /etc/nginx/sites-enabled /etc/nginx/conf.d 2>/dev/null \
    | grep -v '/sites-enabled/flutter$' >/dev/null; then
    warn "Another nginx site already uses server_name ${URL_HOST}."
    warn "Duplicate vhosts are ignored; keep only one of: /etc/nginx/sites-enabled/flutter or the existing site."
  fi

  nginx -t
  start_nginx

  if [[ "$LETSENCRYPT" -eq 1 ]]; then
    log "Requesting Let's Encrypt certificate"
    certbot --nginx --non-interactive --agree-tos --no-eff-email \
      --email "$LE_EMAIL" -d "$URL_HOST" --redirect
  fi
fi

if command -v ufw >/dev/null 2>&1 && ufw status | grep -q 'Status: active'; then
  log "Opening firewall ports"
  ufw allow OpenSSH >/dev/null
  if [[ "$INSTALL_NGINX" -eq 1 ]]; then
    ufw allow 80/tcp >/dev/null
    ufw allow 443/tcp >/dev/null
  else
    ufw allow 3010/tcp >/dev/null
  fi
  if [[ "$INSTALL_DAEMON" -eq 1 ]]; then
    ufw allow 8080/tcp >/dev/null
    ufw allow 2022/tcp >/dev/null
  fi
fi

api_ready=0
for _ in $(seq 1 45); do
  if curl -fsS "http://127.0.0.1:4000/api/v1/health" >/dev/null 2>&1; then
    api_ready=1
    break
  fi
  sleep 2
done
[[ "$api_ready" -eq 1 ]] || fail "API did not become ready on 127.0.0.1:4000"

ui_phase "CREATING ADMIN ACCOUNT...."
admin_json="$(
  as_flutter bash -lc "cd $(printf '%q' "$PREFIX") && \
    FLUTTER_ADMIN_EMAIL=$(printf '%q' "$ADMIN_EMAIL") \
    FLUTTER_ADMIN_PASSWORD=$(printf '%q' "$ADMIN_PASSWORD") \
    FLUTTER_ADMIN_USERNAME=$(printf '%q' "$ADMIN_USERNAME") \
    node scripts/bootstrap-admin.mjs"
)" || die "Failed to create the admin account"
if printf '%s' "$admin_json" | grep -q '"created":true'; then
  ADMIN_CREATED=1
else
  ADMIN_CREATED=0
  warn "An admin account already exists; leaving it in place."
fi

if [[ "$MIGRATE_SERVERS" -eq 1 && -n "$PTERO_DUMP" && -f "$PTERO_DUMP" ]]; then
  ui_phase "MIGRATING SERVERS...."
  install -m 600 "$PTERO_DUMP" "$PREFIX/ptero-export.json"
  chown "$SERVICE_USER:$SERVICE_USER" "$PREFIX/ptero-export.json"
  migrate_ok=1
  migrate_json="$(
    as_flutter bash -lc "cd $(printf '%q' "$PREFIX") && \
      FLUTTER_PTERO_DUMP=$(printf '%q' "$PREFIX/ptero-export.json") \
      FLUTTER_ADMIN_EMAIL=$(printf '%q' "$ADMIN_EMAIL") \
      FLUTTER_ADMIN_PASSWORD=$(printf '%q' "$ADMIN_PASSWORD") \
      node scripts/migrate-pterodactyl.mjs"
  )" || migrate_ok=0
  if [[ "$migrate_ok" -ne 1 ]]; then
    fail "Pterodactyl/Pelican migration reported errors"
  fi
  if [[ -n "${migrate_json:-}" ]]; then
    MIGRATED_EGGS="$(printf '%s' "$migrate_json" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("eggsImported",0))' 2>/dev/null || echo 0)"
    MIGRATED_SERVERS="$(printf '%s' "$migrate_json" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("serversCreated",0))' 2>/dev/null || echo 0)"
    SKIPPED_REMOTE="$(printf '%s' "$migrate_json" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("skippedRemote",0))' 2>/dev/null || echo 0)"
    migrate_errors="$(printf '%s' "$migrate_json" | python3 -c 'import json,sys; e=json.load(sys.stdin).get("errors") or []; print(len(e))' 2>/dev/null || echo 0)"
    if [[ "$migrate_errors" != "0" ]]; then
      migrate_ok=0
      fail "Some eggs or servers could not be imported. See the migrate-pterodactyl output above."
    fi
  fi
  rm -f "$PREFIX/ptero-export.json"
  if [[ "$migrate_ok" -eq 1 ]]; then
    rm -f "$PTERO_DUMP"
  else
    warn "Keeping ${PTERO_DUMP} so you can retry the import."
  fi
fi

sleep 2
if systemctl is-active --quiet flutter-api && systemctl is-active --quiet flutter-web; then
  ok "API and panel are running"
else
  fail "One or more services failed to start. Check: journalctl -u flutter-api -u flutter-web -e"
fi

WEB_PORT="3010"
if [[ "$INSTALL_NGINX" -eq 1 ]]; then
  if [[ "$LETSENCRYPT" -eq 1 || "$URL_SCHEME" == "https" ]]; then
    WEB_PORT="80 / 443"
  else
    WEB_PORT="80"
  fi
fi

DAEMON_LABEL="not installed"
SFTP_LABEL="not installed"
if [[ "$INSTALL_DAEMON" -eq 1 ]]; then
  DAEMON_LABEL="8080"
  SFTP_LABEL="2022"
fi

PASSWORD_NOTE="$ADMIN_PASSWORD"
if [[ "$ADMIN_CREATED" -eq 0 ]]; then
  PASSWORD_NOTE="(existing account kept)"
elif [[ "$ADMIN_GENERATED" -eq 1 ]]; then
  PASSWORD_NOTE="$ADMIN_PASSWORD"
fi

ui_banner_flutter
ui_kv_table \
  "Panel URL" "$APP_URL" \
  "Admin username" "$ADMIN_USERNAME" \
  "Admin email" "$ADMIN_EMAIL" \
  "Admin password" "$PASSWORD_NOTE" \
  "Database URL" "${DATABASE_URL:-mongodb://127.0.0.1:27017/flutter?replicaSet=rs0}" \
  "Redis URL" "${REDIS_URL:-redis://127.0.0.1:6379}" \
  "API" "127.0.0.1:4000" \
  "Web ports" "$WEB_PORT" \
  "Daemon port" "$DAEMON_LABEL" \
  "SFTP port" "$SFTP_LABEL" \
  "Install dir" "$PREFIX" \
  "Data dir" "$DATA_DIR" \
  "Nginx" "$([[ "$INSTALL_NGINX" -eq 1 ]] && echo Yes || echo No)" \
  "Let's Encrypt" "$([[ "$LETSENCRYPT" -eq 1 ]] && echo Yes || echo No)" \
  "Migrated eggs" "$MIGRATED_EGGS" \
  "Migrated servers" "$MIGRATED_SERVERS" \
  "Copied volumes" "$COPIED_VOLUMES"

if [[ "$ADMIN_CREATED" -eq 1 && "$ADMIN_GENERATED" -eq 1 ]]; then
  printf '\n%sSave this admin password now — it will not be shown again.%s\n' "$RED$BOLD" "$RESET"
fi
if [[ "$SKIPPED_REMOTE" != "0" ]]; then
  warn "Skipped ${SKIPPED_REMOTE} server(s) that were on another Pterodactyl/Pelican node."
fi

cat <<EOF

Useful commands:
  systemctl status flutter-api flutter-web flutter-daemon
  journalctl -u flutter-api -u flutter-web -u flutter-daemon -f
  cd ${PREFIX} && docker compose ps

Game servers publish ports on this machine (for example 25565). Allow those
ports in your firewall as you add allocations.
EOF
