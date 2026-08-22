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
#   --yes              Use defaults / env vars, do not prompt
#   --url URL          Public panel URL (http://IP or https://hostname)
#   --email EMAIL      Email for Let's Encrypt
#   --letsencrypt      Request a Let's Encrypt certificate (https URL + hostname)
#   --no-nginx         Skip nginx reverse proxy
#   --no-daemon        Skip installing the local game-node daemon
#   --force            Continue on a distro that is not Ubuntu 24.04
#   --prefix DIR       Install directory (default /opt/flutter)
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
APP_URL="${FLUTTER_URL:-}"
LE_EMAIL="${FLUTTER_EMAIL:-}"

if [[ "${FLUTTER_LETSENCRYPT:-}" == "1" ]]; then
  LETSENCRYPT=1
fi
if [[ "${FLUTTER_NO_NGINX:-}" == "1" ]]; then
  INSTALL_NGINX=0
fi
if [[ "${FLUTTER_NO_DAEMON:-}" == "1" ]]; then
  INSTALL_DAEMON=0
fi

log() { printf '[flutter] %s\n' "$*"; }
warn() { printf '[flutter] warning: %s\n' "$*" >&2; }
die() { printf '[flutter] error: %s\n' "$*" >&2; exit 1; }

usage() {
  sed -n '2,24p' "$0"
  exit 0
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --yes|-y) YES=1 ;;
    --force) FORCE=1 ;;
    --no-nginx) INSTALL_NGINX=0 ;;
    --no-daemon) INSTALL_DAEMON=0 ;;
    --letsencrypt) LETSENCRYPT=1 ;;
    --url) APP_URL="${2:?}"; shift ;;
    --email) LE_EMAIL="${2:?}"; shift ;;
    --prefix) PREFIX="${2:?}"; shift ;;
    --help|-h) usage ;;
    *) die "Unknown option: $1 (see --help)" ;;
  esac
  shift
done

[[ "$(id -u)" -eq 0 ]] || die "Run as root: sudo bash install/ubuntu-24.04.sh"

ask() {
  local __name="$1" __prompt="$2" __default="${3:-}"
  local __current="${!__name:-}"
  if [[ -n "$__current" ]]; then
    return 0
  fi
  if [[ "$YES" -eq 1 ]]; then
    printf -v "$__name" '%s' "$__default"
    return 0
  fi
  local __input=""
  local __display="$__prompt"
  if [[ -n "$__default" ]]; then
    __display="$__prompt [$__default]"
  fi
  if [[ -e /dev/tty ]]; then
    read -r -p "$__display: " __input </dev/tty || true
  elif [[ -t 0 ]]; then
    read -r -p "$__display: " __input || true
  else
    __input="$__default"
  fi
  if [[ -z "$__input" ]]; then
    __input="$__default"
  fi
  printf -v "$__name" '%s' "$__input"
}

confirm() {
  local __prompt="$1" __default="${2:-y}" CONFIRM_ANSWER=""
  if [[ "$YES" -eq 1 ]]; then
    [[ "$__default" == "y" ]]
    return $?
  fi
  ask CONFIRM_ANSWER "$__prompt" "$__default"
  case "${CONFIRM_ANSWER,,}" in
    y|yes) return 0 ;;
    *) return 1 ;;
  esac
}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
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

if [[ "${ID:-}" != "ubuntu" || "${VERSION_ID:-}" != "24.04" ]]; then
  warn "This installer targets Ubuntu 24.04. Detected ${PRETTY_NAME:-unknown}."
  if [[ "$FORCE" -ne 1 ]]; then
    confirm "Continue anyway?" "n" || die "Aborted. Re-run with --force to skip this check."
  fi
fi

PUBLIC_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
PUBLIC_IP="${PUBLIC_IP:-127.0.0.1}"
ask APP_URL "Public panel URL" "http://${PUBLIC_IP}"

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

if [[ "$INSTALL_NGINX" -eq 1 && "$LETSENCRYPT" -eq 0 && "$URL_SCHEME" == "https" && "$IS_IP" -eq 0 && "$YES" -eq 0 ]]; then
  if confirm "Issue a Let's Encrypt certificate for ${URL_HOST}?" "y"; then
    LETSENCRYPT=1
  fi
fi

if [[ "$LETSENCRYPT" -eq 1 ]]; then
  [[ "$INSTALL_NGINX" -eq 1 ]] || die "Let's Encrypt requires nginx"
  [[ "$IS_IP" -eq 0 ]] || die "Let's Encrypt needs a hostname, not an IP address"
  ask LE_EMAIL "Email for Let's Encrypt" ""
  [[ -n "$LE_EMAIL" ]] || die "An email address is required for Let's Encrypt"
  if [[ "$URL_SCHEME" != "https" ]]; then
    APP_URL="https://${URL_HOST}"
    URL_SCHEME=https
    COOKIE_SECURE=true
  fi
fi

if [[ "$INSTALL_DAEMON" -eq 1 && "$YES" -eq 0 ]]; then
  if ! confirm "Install the game-node daemon on this machine?" "y"; then
    INSTALL_DAEMON=0
  fi
fi

log "Installing Flutter to ${PREFIX}"
log "Public URL: ${APP_URL}"

export DEBIAN_FRONTEND=noninteractive
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
chown "$SERVICE_USER:$SERVICE_USER" "$DATA_DIR"

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
DATABASE_URL=mongodb://127.0.0.1:27017/flutter?replicaSet=rs0
REDIS_URL=redis://127.0.0.1:6379
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
  # Keep secrets; refresh public URL and cookie flag for this install.
  sed -i "s|^APP_URL=.*|APP_URL=${APP_URL}|" "$ENV_FILE"
  sed -i "s|^COOKIE_SECURE=.*|COOKIE_SECURE=${COOKIE_SECURE}|" "$ENV_FILE"
  grep -q '^HOST=' "$ENV_FILE" || echo 'HOST=127.0.0.1' >> "$ENV_FILE"
  grep -q '^DAEMON_DATA_DIR=' "$ENV_FILE" || echo "DAEMON_DATA_DIR=${DATA_DIR}" >> "$ENV_FILE"
  grep -q '^DAEMON_CONFIG=' "$ENV_FILE" || echo "DAEMON_CONFIG=${PREFIX}/apps/daemon/data/config.json" >> "$ENV_FILE"
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
  log "Configuring local daemon"
  as_flutter bash -lc "cd $(printf '%q' "$PREFIX") && node scripts/ensure-daemon.mjs"
fi

install -m 644 "$PREFIX/install/systemd/flutter-api.service" /etc/systemd/system/flutter-api.service
install -m 644 "$PREFIX/install/systemd/flutter-web.service" /etc/systemd/system/flutter-web.service
if [[ "$INSTALL_DAEMON" -eq 1 ]]; then
  install -m 644 "$PREFIX/install/systemd/flutter-daemon.service" /etc/systemd/system/flutter-daemon.service
fi

# Point unit files at a custom prefix if it is not /opt/flutter.
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
  warn "nginx.service failed to start. Recent logs:"
  journalctl -u nginx.service -n 40 --no-pager || true
  warn "Listeners on :80 / :443:"
  ss -tlnp 2>/dev/null | grep -E ':80|:443' || true
  warn "Enabled sites:"
  ls -la /etc/nginx/sites-enabled/ || true
  die "nginx failed to start. Fix the error above, then re-run: systemctl restart nginx"
}

if [[ "$INSTALL_NGINX" -eq 1 ]]; then
  log "Configuring nginx"
  install -m 644 "$PREFIX/install/nginx/upgrade-map.conf" /etc/nginx/conf.d/flutter-upgrade.conf
  sed "s/__SERVER_NAME__/${URL_HOST}/g" "$PREFIX/install/nginx/flutter.conf" > /etc/nginx/sites-available/flutter
  # Hosts with IPv6 disabled fail at start (not during nginx -t) on listen [::]:80
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
  fi
fi

sleep 2
if systemctl is-active --quiet flutter-api && systemctl is-active --quiet flutter-web; then
  log "API and panel are running"
else
  warn "One or more services failed to start. Check: journalctl -u flutter-api -u flutter-web -e"
fi

cat <<EOF

Flutter is installed.

  Panel     ${APP_URL}
  API       127.0.0.1:4000 (proxied at ${APP_URL}/api/)
  Install   ${PREFIX}
  Data      ${DATA_DIR}

Open ${APP_URL} and create the first admin account.

Useful commands:
  systemctl status flutter-api flutter-web flutter-daemon
  journalctl -u flutter-api -u flutter-web -u flutter-daemon -f
  cd ${PREFIX} && docker compose ps

Game servers publish ports on this machine (for example 25565). Allow those
ports in your firewall as you add allocations.
EOF
