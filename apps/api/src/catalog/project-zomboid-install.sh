#!/bin/bash
set -euo pipefail

# Flutter mounts this directory as /home/container when the server runs.
APP_ID="${SRCDS_APPID:-380870}"
STEAM_USER="${STEAM_USER:-}"
STEAM_PASS="${STEAM_PASS:-}"
STEAM_AUTH="${STEAM_AUTH:-}"

if [[ -z "${STEAM_USER}" || -z "${STEAM_PASS}" ]]; then
  echo "[flutter] SteamCMD anonymous login (dedicated server app ${APP_ID})"
  LOGIN=(+login anonymous)
else
  echo "[flutter] SteamCMD login as ${STEAM_USER}"
  LOGIN=(+login "${STEAM_USER}" "${STEAM_PASS}" "${STEAM_AUTH}")
fi

cd /tmp
mkdir -p /mnt/server/steamcmd /mnt/server/steamapps
curl -fsSL -o steamcmd.tar.gz https://steamcdn-a.akamaihd.net/client/installer/steamcmd_linux.tar.gz
tar -xzf steamcmd.tar.gz -C /mnt/server/steamcmd
rm -f steamcmd.tar.gz

export HOME=/mnt/server
cd /mnt/server/steamcmd

BETA_ARGS=()
if [[ -n "${SRCDS_BETAID:-}" ]]; then
  BETA_ARGS+=(-beta "${SRCDS_BETAID}")
fi
if [[ -n "${SRCDS_BETAPASS:-}" ]]; then
  BETA_ARGS+=(-betapassword "${SRCDS_BETAPASS}")
fi

set +u
./steamcmd.sh +@ShutdownOnFailedCommand 1 +@NoPromptForPassword 1 \
  +force_install_dir /mnt/server \
  "${LOGIN[@]}" \
  +app_update "${APP_ID}" "${BETA_ARGS[@]}" validate +quit
set -u

mkdir -p /mnt/server/.steam/sdk32 /mnt/server/.steam/sdk64
if [[ -f linux32/steamclient.so ]]; then
  cp -f linux32/steamclient.so /mnt/server/.steam/sdk32/steamclient.so
fi
if [[ -f linux64/steamclient.so ]]; then
  cp -f linux64/steamclient.so /mnt/server/.steam/sdk64/steamclient.so
fi

chmod +x /mnt/server/ProjectZomboid64 /mnt/server/start-server.sh 2>/dev/null || true
mkdir -p /mnt/server/.cache/Server /mnt/server/.cache/tmp

# Runtime launcher reads Flutter env vars on each start (ports, memory, workshop).
cat > /mnt/server/zomboid-start.sh << 'LAUNCH'
#!/bin/bash
set -e
cd /home/container
export HOME=/home/container
export PATH="./jre64/bin:$PATH"
export LD_LIBRARY_PATH="./linux64:./natives:.:./jre64/lib/amd64:${LD_LIBRARY_PATH}"
export TMPDIR="/home/container/.cache/tmp"
mkdir -p "$TMPDIR" .cache/Server .steam/sdk64

if [ ! -f ./ProjectZomboid64 ]; then
  echo "[flutter] ProjectZomboid64 is missing. Reinstall this server."
  exit 1
fi
chmod +x ./ProjectZomboid64 2>/dev/null || true

APP_ID="${SRCDS_APPID:-380870}"
if [ "${AUTO_UPDATE}" = "1" ] && [ -x ./steamcmd/steamcmd.sh ]; then
  echo "[flutter] Updating Project Zomboid (app ${APP_ID})…"
  BETA_ARGS=()
  [ -n "${SRCDS_BETAID}" ] && BETA_ARGS+=(-beta "${SRCDS_BETAID}")
  [ -n "${SRCDS_BETAPASS}" ] && BETA_ARGS+=(-betapassword "${SRCDS_BETAPASS}")
  ./steamcmd/steamcmd.sh +@ShutdownOnFailedCommand 1 +@NoPromptForPassword 1 \
    +force_install_dir /home/container +login anonymous \
    +app_update "${APP_ID}" "${BETA_ARGS[@]}" +quit
fi

UDP_PORT="${STEAM_PORT:-${SERVER_PORT_1:-}}"
if [ -z "${UDP_PORT}" ]; then
  UDP_PORT=$((SERVER_PORT + 1))
fi

SERVER_NAME="${SERVER_NAME:-Flutter}"
PUBLIC_NAME="${PUBLIC_NAME:-$SERVER_NAME}"
INI=".cache/Server/${SERVER_NAME}.ini"
touch "$INI"

upsert_ini() {
  local key="$1" value="$2" file="$3"
  if grep -q "^${key}=" "$file" 2>/dev/null; then
    sed -i "s|^${key}=.*|${key}=${value}|" "$file"
  else
    printf '%s=%s\n' "$key" "$value" >> "$file"
  fi
}

upsert_ini MaxPlayers "${MAX_PLAYERS:-16}" "$INI"
upsert_ini PublicName "${PUBLIC_NAME}" "$INI"
upsert_ini Password "${SERVER_PASSWORD:-}" "$INI"
upsert_ini DefaultPort "${SERVER_PORT}" "$INI"
upsert_ini UDPPort "${UDP_PORT}" "$INI"
upsert_ini BackupsOnStart "false" "$INI"
upsert_ini WorkshopItems "${WORKSHOP_ITEMS:-}" "$INI"
upsert_ini Mods "${MODS:-}" "$INI"

HEAP="${SERVER_MEMORY:-4096}"
if [ -z "$HEAP" ] || [ "$HEAP" = "0" ]; then HEAP=4096; fi

echo "[flutter] Project Zomboid query ${SERVER_PORT}/udp  direct ${UDP_PORT}/udp  heap ${HEAP}m"
export LD_PRELOAD="${LD_PRELOAD}:libjsig.so"
exec ./ProjectZomboid64 \
  -Xmx"${HEAP}"m \
  -port "${SERVER_PORT}" \
  -udpport "${UDP_PORT}" \
  -cachedir /home/container/.cache \
  -servername "${SERVER_NAME}" \
  -adminusername "${ADMIN_USER:-admin}" \
  -adminpassword "${ADMIN_PASSWORD:-changeme}"
LAUNCH
chmod +x /mnt/server/zomboid-start.sh

echo "[flutter] Project Zomboid install finished."
