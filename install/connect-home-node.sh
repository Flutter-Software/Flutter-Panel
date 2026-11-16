#!/usr/bin/env bash
# Attach this Ubuntu machine as a Flutter game node to a hosted panel.
# Use this when the node has no public IP: a Cloudflare quick tunnel
# gives the panel a reachable HTTPS URL for start/stop/files/console.
#
# On the Ubuntu host:
#   curl -fsSL https://raw.githubusercontent.com/Flutter-Software/Flutter-Panel/main/install/connect-home-node.sh \
#     | sudo bash -s -- --token flt_... --node <id>
#
# Or from a checkout:
#   sudo bash install/connect-home-node.sh --token flt_... --node <id>
#
# Options:
#   --token TOKEN        Node token from Admin → Nodes
#   --node ID            Node id from Admin → Nodes
#   --panel-url URL      Default https://panel.flutter.software
#   --listen-url URL     Skip the tunnel and use this URL (public IP / Tailscale)
#   --port PORT          Daemon port (default 8080)
#   --host HOST          Daemon bind address. Default 127.0.0.1 with the tunnel
#                        (only cloudflared talks to it), 0.0.0.0 without it
#   --no-tunnel          Do not start Cloudflare; you must pass --listen-url
set -euo pipefail

PANEL_URL="${FLUTTER_PANEL_URL:-https://panel.flutter.software}"
NODE_TOKEN="${FLUTTER_NODE_TOKEN:-}"
NODE_ID="${FLUTTER_NODE_ID:-}"
LISTEN_URL="${FLUTTER_LISTEN_URL:-}"
DAEMON_PORT="${FLUTTER_DAEMON_PORT:-8080}"
# Empty = pick from the mode below (loopback behind the tunnel, all interfaces otherwise).
DAEMON_HOST="${FLUTTER_DAEMON_HOST:-}"
USE_TUNNEL=1
PREFIX="${FLUTTER_NODE_PREFIX:-/opt/flutter-node}"
TUNNEL_LOG="/var/log/flutter-cloudflared.log"
TUNNEL_UNIT="flutter-node-tunnel.service"

log() { printf '[flutter-connect] %s\n' "$*"; }
warn() { printf '[flutter-connect] warning: %s\n' "$*" >&2; }
die() { printf '[flutter-connect] error: %s\n' "$*" >&2; exit 1; }

usage() {
  sed -n '2,21p' "$0"
  exit 0
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --token) NODE_TOKEN="${2:?}"; shift ;;
    --node) NODE_ID="${2:?}"; shift ;;
    --panel-url) PANEL_URL="${2:?}"; shift ;;
    --listen-url) LISTEN_URL="${2:?}"; USE_TUNNEL=0; shift ;;
    --port) DAEMON_PORT="${2:?}"; shift ;;
    --host) DAEMON_HOST="${2:?}"; shift ;;
    --no-tunnel) USE_TUNNEL=0 ;;
    --help|-h) usage ;;
    *) die "Unknown option: $1" ;;
  esac
  shift
done

[[ "$(id -u)" -eq 0 ]] || die "Run as root: sudo bash install/connect-home-node.sh"
PANEL_URL="${PANEL_URL%/}"
[[ -n "$NODE_TOKEN" ]] || die "Pass --token (the flt_ value from Admin → Nodes)"
[[ -n "$NODE_ID" ]] || die "Pass --node (the node id from Admin → Nodes)"
[[ "$PANEL_URL" == http://* || "$PANEL_URL" == https://* ]] || PANEL_URL="https://${PANEL_URL}"

if [[ "$USE_TUNNEL" -eq 0 && -z "$LISTEN_URL" ]]; then
  die "Without a tunnel you must pass --listen-url (a URL the panel can reach)."
fi
if [[ "$USE_TUNNEL" -eq 0 && ( "$LISTEN_URL" == *127.0.0.1* || "$LISTEN_URL" == *localhost* ) ]]; then
  die "--listen-url is a loopback address; a hosted panel can't reach it. Use this machine's public or Tailscale address."
fi

# Behind the tunnel only cloudflared (on this machine) connects, so keep the
# daemon off the network. Without it, the panel connects directly to the
# listen URL, so the daemon must accept connections on every interface.
if [[ -z "$DAEMON_HOST" ]]; then
  if [[ "$USE_TUNNEL" -eq 1 ]]; then DAEMON_HOST="127.0.0.1"; else DAEMON_HOST="0.0.0.0"; fi
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALLER=""
if [[ -f "$SCRIPT_DIR/ubuntu-node.sh" ]]; then
  INSTALLER="$SCRIPT_DIR/ubuntu-node.sh"
fi

NEED_INSTALL=0
if [[ ! -x /usr/local/sbin/flutter-node-configure ]]; then
  NEED_INSTALL=1
fi
if [[ ! -d "$PREFIX/apps/daemon" ]]; then
  NEED_INSTALL=1
fi

if [[ "$NEED_INSTALL" -eq 1 ]]; then
  log "Installing the daemon (no panel) on this machine"
  [[ -n "$INSTALLER" ]] || die "ubuntu-node.sh not found next to this script"
  bash "$INSTALLER" --yes --force --skip-configure --panel-url "$PANEL_URL" --port "$DAEMON_PORT"
fi

[[ -x /usr/local/sbin/flutter-node-configure ]] \
  || die "flutter-node-configure is missing; daemon install failed. Scroll up for the ubuntu-node error."

CONFIGURE_BIN="$(command -v flutter-node-configure || true)"
CONFIGURE_BIN="${CONFIGURE_BIN:-/usr/local/sbin/flutter-node-configure}"

if [[ "$USE_TUNNEL" -eq 1 ]]; then
  if ! command -v cloudflared >/dev/null 2>&1; then
    log "Installing cloudflared for a public tunnel (this host has no public IP)"
    arch="$(dpkg --print-architecture)"
    case "$arch" in
      amd64) cf_arch=amd64 ;;
      arm64) cf_arch=arm64 ;;
      *) die "Unsupported architecture for cloudflared: ${arch}" ;;
    esac
    tmp="$(mktemp)"
    curl -fsSL "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${cf_arch}.deb" -o "$tmp"
    dpkg -i "$tmp" >/dev/null
    rm -f "$tmp"
  fi

  cat > "/etc/systemd/system/${TUNNEL_UNIT}" <<EOF
[Unit]
Description=Flutter node Cloudflare tunnel
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=/usr/bin/cloudflared tunnel --no-autoupdate --url http://127.0.0.1:${DAEMON_PORT}
Restart=on-failure
RestartSec=3
StandardOutput=append:${TUNNEL_LOG}
StandardError=append:${TUNNEL_LOG}

[Install]
WantedBy=multi-user.target
EOF
  mkdir -p "$(dirname "$TUNNEL_LOG")"
  : > "$TUNNEL_LOG"
  systemctl daemon-reload
  systemctl enable --now "$TUNNEL_UNIT"

  log "Waiting for Cloudflare to publish a public URL"
  LISTEN_URL=""
  for _ in $(seq 1 40); do
    LISTEN_URL="$(grep -oE 'https://[a-zA-Z0-9.-]+\.trycloudflare\.com' "$TUNNEL_LOG" | tail -n1 || true)"
    if [[ -n "$LISTEN_URL" ]]; then
      break
    fi
    sleep 1
  done
  [[ -n "$LISTEN_URL" ]] || die "Cloudflare tunnel did not print a URL. Check: journalctl -u ${TUNNEL_UNIT} -e"
  log "Tunnel URL ${LISTEN_URL}"
else
  # Switching an existing tunnel node to a direct URL: the old tunnel would
  # keep running (and restarting) for nothing.
  if [[ -f "/etc/systemd/system/${TUNNEL_UNIT}" ]]; then
    log "Stopping the Cloudflare tunnel (not needed with --listen-url)"
    systemctl disable --now "${TUNNEL_UNIT}" >/dev/null 2>&1 || true
  fi
  # The panel connects straight to this port now. ubuntu-node.sh opens it on a
  # fresh install; do it again in case the daemon was installed earlier.
  if command -v ufw >/dev/null 2>&1 && ufw status | grep -q 'Status: active'; then
    log "Opening daemon ${DAEMON_PORT}/tcp in ufw"
    ufw allow "${DAEMON_PORT}/tcp" >/dev/null
  fi
fi

log "Configuring daemon → ${PANEL_URL}  listen ${LISTEN_URL}  bind ${DAEMON_HOST}:${DAEMON_PORT}"
"$CONFIGURE_BIN" \
  --panel-url "$PANEL_URL" \
  --token "$NODE_TOKEN" \
  --node "$NODE_ID" \
  --host "$DAEMON_HOST" \
  --port "$DAEMON_PORT" \
  --listen-url "$LISTEN_URL" \
  --data-dir /var/lib/flutter \
  --config "${PREFIX}/apps/daemon/data/config.json"

systemctl enable --now flutter-daemon
systemctl restart flutter-daemon

cat <<EOF

This machine is attached to ${PANEL_URL}

  Node id      ${NODE_ID}
  Listen URL   ${LISTEN_URL}
  Bind         ${DAEMON_HOST}:${DAEMON_PORT}
  Daemon       systemctl status flutter-daemon

Admin → Nodes should go Online after a heartbeat (about 15s).

Notes:
EOF
if [[ "$USE_TUNNEL" -eq 1 ]]; then
  cat <<EOF
  - A Cloudflare quick tunnel URL changes when ${TUNNEL_UNIT} restarts.
    Re-run this script if the node goes offline after a reboot.
EOF
else
  cat <<EOF
  - The panel connects directly to ${LISTEN_URL}. Make sure your router or
    cloud firewall forwards that address to this machine's port ${DAEMON_PORT}.
EOF
fi
cat <<EOF
  - Windows npm run dev:daemon is a different process; leave it stopped on
    this Ubuntu host so port ${DAEMON_PORT} is free.
EOF
