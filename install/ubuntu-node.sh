#!/usr/bin/env bash
# Flutter daemon-only installer. Installs Docker + Node + the game-node agent.
# Does not install the panel, MongoDB, Redis, or nginx.
#
# On a fresh Ubuntu host:
#   curl -fsSL https://raw.githubusercontent.com/Flutter-Software/Flutter-Panel/main/install/ubuntu-node.sh \
#     | sudo bash -s -- --panel-url https://panel.example.com --token flt_... --node <id> \
#       --listen-url http://THIS_SERVER_IP:8080
#
# From a git checkout:
#   sudo bash install/ubuntu-node.sh --panel-url https://panel.example.com \
#     --token flt_... --node <id> --listen-url http://THIS_SERVER_IP:8080
#
# Options:
#   --panel-url URL    Public panel URL (https://panel.example.com)
#   --token TOKEN      Node token from Admin → Nodes (flt_...)
#   --node ID          Node id from Admin → Nodes
#   --listen-url URL   URL the panel API can reach (not 127.0.0.1)
#   --port PORT        Daemon listen port (default 8080)
#   --host HOST        Bind address (default 0.0.0.0)
#   --prefix DIR       Install directory (default /opt/flutter-node)
#   --data-dir DIR     Game server files (default /var/lib/flutter)
#   --yes / -y         Do not prompt
#   --force            Continue on a distro that is not Ubuntu 24.04
#   --skip-configure   Install only; write config later with flutter-node-configure
set -euo pipefail

FLUTTER_REPO="${FLUTTER_REPO:-https://github.com/Flutter-Software/Flutter-Panel.git}"
PREFIX="${FLUTTER_NODE_PREFIX:-/opt/flutter-node}"
DATA_DIR="${FLUTTER_DATA_DIR:-/var/lib/flutter}"
SERVICE_USER="${FLUTTER_USER:-flutter}"
NODE_MAJOR=22
DAEMON_PORT="${FLUTTER_DAEMON_PORT:-8080}"
DAEMON_HOST="${FLUTTER_DAEMON_HOST:-0.0.0.0}"
PANEL_URL="${FLUTTER_PANEL_URL:-}"
NODE_TOKEN="${FLUTTER_NODE_TOKEN:-}"
NODE_ID="${FLUTTER_NODE_ID:-}"
LISTEN_URL="${FLUTTER_LISTEN_URL:-}"
YES=0
FORCE=0
SKIP_CONFIGURE=0

log() { printf '[flutter-node] %s\n' "$*"; }
warn() { printf '[flutter-node] warning: %s\n' "$*" >&2; }
die() { printf '[flutter-node] error: %s\n' "$*" >&2; exit 1; }

usage() {
  sed -n '2,28p' "$0"
  exit 0
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --yes|-y) YES=1 ;;
    --force) FORCE=1 ;;
    --skip-configure) SKIP_CONFIGURE=1 ;;
    --panel-url) PANEL_URL="${2:?}"; shift ;;
    --token) NODE_TOKEN="${2:?}"; shift ;;
    --node) NODE_ID="${2:?}"; shift ;;
    --listen-url) LISTEN_URL="${2:?}"; shift ;;
    --port) DAEMON_PORT="${2:?}"; shift ;;
    --host) DAEMON_HOST="${2:?}"; shift ;;
    --prefix) PREFIX="${2:?}"; shift ;;
    --data-dir) DATA_DIR="${2:?}"; shift ;;
    --help|-h) usage ;;
    *) die "Unknown option: $1 (see --help)" ;;
  esac
  shift
done

[[ "$(id -u)" -eq 0 ]] || die "Run as root: sudo bash install/ubuntu-node.sh"

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

if [[ -f /etc/os-release ]]; then
  # shellcheck disable=SC1091
  . /etc/os-release
else
  die "Cannot read /etc/os-release"
fi

if [[ "${ID:-}" != "ubuntu" || "${VERSION_ID:-}" != "24.04" ]]; then
  warn "This installer targets Ubuntu 24.04. Detected ${PRETTY_NAME:-unknown}."
  [[ "$FORCE" -eq 1 ]] || die "Re-run with --force to skip this check."
fi

if [[ -f /etc/systemd/system/flutter-api.service ]] && systemctl is-enabled --quiet flutter-api.service 2>/dev/null; then
  die "This host is already running the Flutter panel (flutter-api). Use a different machine for a remote node."
fi

PUBLIC_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
PUBLIC_IP="${PUBLIC_IP:-127.0.0.1}"

ask PANEL_URL "Public panel URL" ""
ask NODE_TOKEN "Node token (flt_...)" ""
ask NODE_ID "Node id" ""
ask LISTEN_URL "URL the panel should use to reach this daemon" "http://${PUBLIC_IP}:${DAEMON_PORT}"
ask DAEMON_PORT "Daemon port" "$DAEMON_PORT"

PANEL_URL="${PANEL_URL%/}"
[[ -n "$PANEL_URL" ]] || die "A --panel-url is required"
[[ "$PANEL_URL" == http://* || "$PANEL_URL" == https://* ]] || PANEL_URL="https://${PANEL_URL}"

if [[ "$SKIP_CONFIGURE" -eq 0 ]]; then
  [[ -n "$NODE_TOKEN" ]] || die "A --token is required (or pass --skip-configure)"
  [[ -n "$NODE_ID" ]] || die "A --node id is required (or pass --skip-configure)"
fi

if [[ "$LISTEN_URL" == *127.0.0.1* || "$LISTEN_URL" == *localhost* ]]; then
  warn "listen-url is loopback. The panel on another host cannot reach this daemon."
fi

if systemctl is-active --quiet wings 2>/dev/null || pgrep -x wings >/dev/null 2>&1; then
  die "Pterodactyl Wings is running (it binds :8080). Remove it first: sudo bash install/wipe-pterodactyl.sh --yes"
fi
if [[ -d /etc/pterodactyl || -x /usr/local/bin/wings ]]; then
  warn "Pterodactyl/Wings files are still on this host. Recommended: sudo bash install/wipe-pterodactyl.sh --yes --wings-only"
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y --no-install-recommends \
  ca-certificates curl gnupg git rsync python3 \
  build-essential python3-minimal

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

if ! command -v docker >/dev/null 2>&1; then
  log "Installing Docker Engine"
  if ! curl -fsSL https://get.docker.com | sh; then
    warn "get.docker.com failed; using the Docker apt repository"
    install_docker_apt_repo
    apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin
  fi
fi
systemctl enable --now docker 2>/dev/null || true
if ! docker info >/dev/null 2>&1; then
  die "Docker is not running. On WSL, enable Docker Desktop → Settings → Resources → WSL integration, then retry."
fi

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
usermod --home "$PREFIX" "$SERVICE_USER" >/dev/null 2>&1 || true

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SOURCE=""
if [[ -f "$REPO_ROOT/apps/daemon/package.json" && -f "$REPO_ROOT/packages/shared/package.json" ]]; then
  SOURCE="$REPO_ROOT"
fi

if [[ -z "$SOURCE" ]]; then
  log "Cloning ${FLUTTER_REPO}"
  SOURCE="/usr/local/src/flutter-panel"
  if [[ -d "$SOURCE/.git" ]]; then
    git -C "$SOURCE" fetch --depth 1 origin
    git -C "$SOURCE" reset --hard FETCH_HEAD
  else
    rm -rf "$SOURCE"
    git clone --depth 1 "$FLUTTER_REPO" "$SOURCE"
  fi
fi

UNIT_FILE=""
for candidate in \
  "$SCRIPT_DIR/systemd/flutter-node.service" \
  "$SCRIPT_DIR/install/systemd/flutter-node.service" \
  "$SOURCE/install/systemd/flutter-node.service"
do
  if [[ -f "$candidate" ]]; then
    UNIT_FILE="$candidate"
    break
  fi
done
[[ -n "$UNIT_FILE" ]] || die "Missing flutter-node.service (copy install/systemd/flutter-node.service next to ubuntu-node.sh)"
[[ -f "$SOURCE/scripts/link-shared.mjs" ]] || die "Missing scripts/link-shared.mjs in ${SOURCE}"

log "Installing daemon files to ${PREFIX}"
mkdir -p "$PREFIX" "$DATA_DIR" \
  "$PREFIX/apps/daemon/data" \
  "$PREFIX/packages/shared" \
  "$PREFIX/scripts"
rsync -a --delete \
  --exclude 'node_modules/' \
  --exclude 'data/config.json' \
  "$SOURCE/apps/daemon/" "$PREFIX/apps/daemon/"
rsync -a --delete \
  --exclude 'node_modules/' \
  "$SOURCE/packages/shared/" "$PREFIX/packages/shared/"
install -m 644 "$SOURCE/scripts/link-shared.mjs" "$PREFIX/scripts/link-shared.mjs"

cat > "$PREFIX/package.json" <<'EOF'
{
  "name": "flutter-node",
  "private": true,
  "workspaces": [
    "apps/daemon",
    "packages/shared"
  ],
  "engines": {
    "node": ">=22"
  }
}
EOF

chown -R "$SERVICE_USER:$SERVICE_USER" "$PREFIX" "$DATA_DIR"

as_flutter() {
  runuser -u "$SERVICE_USER" -- "$@"
}

log "Installing npm packages (daemon + shared only)"
if ! as_flutter bash -lc "cd $(printf '%q' "$PREFIX") && npm install --omit=dev"; then
  warn "npm as ${SERVICE_USER} failed; retrying as root"
  bash -lc "cd $(printf '%q' "$PREFIX") && npm install --omit=dev"
  chown -R "$SERVICE_USER:$SERVICE_USER" "$PREFIX"
fi
as_flutter bash -lc "cd $(printf '%q' "$PREFIX") && node scripts/link-shared.mjs"

sed \
  -e "s|/opt/flutter-node|${PREFIX}|g" \
  -e "s|/var/lib/flutter|${DATA_DIR}|g" \
  -e "s/^User=flutter$/User=${SERVICE_USER}/" \
  -e "s/^Group=flutter$/Group=${SERVICE_USER}/" \
  "$UNIT_FILE" > /etc/systemd/system/flutter-daemon.service

cat > /usr/local/sbin/flutter-node-configure <<EOF
#!/usr/bin/env bash
set -euo pipefail
cd $(printf '%q' "$PREFIX")
exec runuser -u $(printf '%q' "$SERVICE_USER") -- npm run configure -w @flutter-software/daemon -- "\$@"
EOF
chmod 755 /usr/local/sbin/flutter-node-configure

if [[ "$SKIP_CONFIGURE" -eq 0 ]]; then
  log "Writing daemon config"
  as_flutter bash -lc "cd $(printf '%q' "$PREFIX") && npm run configure -w @flutter-software/daemon -- \
    --panel-url $(printf '%q' "$PANEL_URL") \
    --token $(printf '%q' "$NODE_TOKEN") \
    --node $(printf '%q' "$NODE_ID") \
    --host $(printf '%q' "$DAEMON_HOST") \
    --port $(printf '%q' "$DAEMON_PORT") \
    --listen-url $(printf '%q' "$LISTEN_URL") \
    --data-dir $(printf '%q' "$DATA_DIR") \
    --config $(printf '%q' "$PREFIX/apps/daemon/data/config.json")"
fi

if command -v systemctl >/dev/null 2>&1 && systemctl is-system-running >/dev/null 2>&1; then
  systemctl daemon-reload
  systemctl enable flutter-daemon.service
  if [[ "$SKIP_CONFIGURE" -eq 0 ]]; then
    systemctl restart flutter-daemon.service
  else
    log "Config skipped. Run flutter-node-configure then: systemctl enable --now flutter-daemon"
  fi
else
  warn "systemd is not running; skip enabling flutter-daemon. Start it after configure with: systemctl enable --now flutter-daemon"
fi

if command -v ufw >/dev/null 2>&1 && ufw status | grep -q 'Status: active'; then
  log "Opening daemon port ${DAEMON_PORT}/tcp"
  ufw allow "${DAEMON_PORT}/tcp" >/dev/null
fi

if [[ "$SKIP_CONFIGURE" -eq 0 ]]; then
  sleep 2
  if systemctl is-active --quiet flutter-daemon 2>/dev/null; then
    log "Daemon is running"
  else
    warn "Daemon is not active yet. Check: journalctl -u flutter-daemon -e"
  fi
fi

cat <<EOF

Flutter node installed (no panel on this machine).

  Install     ${PREFIX}
  Data        ${DATA_DIR}
  Listen      ${LISTEN_URL:-"(configure first)"}
  Panel       ${PANEL_URL}

Allow ${DAEMON_PORT}/tcp from the panel host, plus each game allocation port.

Useful commands:
  systemctl status flutter-daemon
  journalctl -u flutter-daemon -f
  flutter-node-configure --panel-url ${PANEL_URL} --token <flt_token> --node <id> --listen-url ${LISTEN_URL:-http://${PUBLIC_IP}:${DAEMON_PORT}}

The node turns Online in Admin → Nodes after a heartbeat (every 15s).
EOF
