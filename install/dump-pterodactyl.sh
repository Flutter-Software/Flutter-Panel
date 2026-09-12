#!/usr/bin/env bash
# Dump Pterodactyl / Pelican MySQL tables to JSON for Flutter migration.
# Usage:
#   bash install/dump-pterodactyl.sh --env /var/www/pterodactyl/.env --out /root/flutter-ptero-export.json
#   bash install/dump-pterodactyl.sh --env /var/www/pelican/.env --out dump.json --wings-config /etc/pterodactyl/config.yml
set -euo pipefail

ENV_FILE=""
OUT=""
WINGS_CFG=""

die() { printf 'dump-pterodactyl: %s\n' "$*" >&2; exit 1; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --env) ENV_FILE="${2:?}"; shift ;;
    --out) OUT="${2:?}"; shift ;;
    --wings-config) WINGS_CFG="${2:?}"; shift ;;
    --help|-h)
      sed -n '2,6p' "$0"
      exit 0
      ;;
    *) die "unknown option: $1" ;;
  esac
  shift
done

[[ -n "$ENV_FILE" && -f "$ENV_FILE" ]] || die "missing --env file"
[[ -n "$OUT" ]] || die "missing --out path"

env_value() {
  local key="$1"
  awk -F= -v key="$key" '
    $1 == key {
      sub(/^[^=]+=/, "")
      gsub(/\r/, "")
      gsub(/^["'\'']|["'\'']$/, "")
      print
      exit
    }
  ' "$ENV_FILE" 2>/dev/null || true
}

json_str() {
  local s="$1"
  s=${s//\\/\\\\}
  s=${s//\"/\\\"}
  printf '"%s"' "$s"
}

DB_HOST="$(env_value DB_HOST)"
DB_PORT="$(env_value DB_PORT)"
DB_USER="$(env_value DB_USERNAME)"
[[ -n "$DB_USER" ]] || DB_USER="$(env_value DB_USER)"
DB_PASSWORD="$(env_value DB_PASSWORD)"
DB_NAME="$(env_value DB_DATABASE)"
DB_HOST="${DB_HOST:-127.0.0.1}"
DB_PORT="${DB_PORT:-3306}"
DB_USER="${DB_USER:-pterodactyl}"
DB_NAME="${DB_NAME:-panel}"

MYSQL_BIN="$(command -v mysql || true)"
[[ -n "$MYSQL_BIN" ]] || MYSQL_BIN="$(command -v mariadb || true)"
[[ -n "$MYSQL_BIN" ]] || die "mysql/mariadb client is not installed"

sql() {
  MYSQL_PWD="$DB_PASSWORD" "$MYSQL_BIN" \
    -h "$DB_HOST" \
    -P "$DB_PORT" \
    -u "$DB_USER" \
    --default-character-set=utf8mb4 \
    -N -B \
    "$DB_NAME" \
    -e "$1"
}

table_exists() {
  [[ -n "$(sql "SHOW TABLES LIKE '$1'" 2>/dev/null || true)" ]]
}

json_object_pairs() {
  local table="$1"
  local col pairs=""
  while IFS=$'\t' read -r col _; do
    [[ -n "$col" ]] || continue
    pairs+=", '${col}', \`${col}\`"
  done < <(sql "SHOW COLUMNS FROM \`${table}\`")
  printf '%s' "${pairs#, }"
}

dump_table() {
  local table="$1"
  local dest="$2"
  if ! table_exists "$table"; then
    printf '[]\n' >"$dest"
    return 0
  fi
  local pairs
  pairs="$(json_object_pairs "$table")"
  [[ -n "$pairs" ]] || { printf '[]\n' >"$dest"; return 0; }
  local first=1
  printf '[' >"$dest"
  while IFS= read -r row; do
    [[ -n "$row" ]] || continue
    if [[ "$first" -eq 1 ]]; then
      first=0
    else
      printf ',' >>"$dest"
    fi
    printf '%s' "$row" >>"$dest"
  done < <(sql "SELECT JSON_OBJECT(${pairs}) FROM \`${table}\`")
  printf ']\n' >>"$dest"
}

LOCAL_UUID=""
if [[ -n "$WINGS_CFG" && -f "$WINGS_CFG" ]]; then
  LOCAL_UUID="$(awk '
    $1 == "uuid:" {
      gsub(/["'\''\r]/, "", $2)
      print $2
      exit
    }
  ' "$WINGS_CFG")"
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

for table in nests eggs egg_variables servers server_variables allocations nodes; do
  dump_table "$table" "$TMP/${table}.json"
done

mkdir -p "$(dirname "$OUT")"
{
  printf '{\n'
  printf '  "source": "pterodactyl",\n'
  printf '  "localNodeUuid": %s,\n' "$(json_str "$LOCAL_UUID")"
  printf '  "nests": '; cat "$TMP/nests.json"; printf ',\n'
  printf '  "eggs": '; cat "$TMP/eggs.json"; printf ',\n'
  printf '  "egg_variables": '; cat "$TMP/egg_variables.json"; printf ',\n'
  printf '  "servers": '; cat "$TMP/servers.json"; printf ',\n'
  printf '  "server_variables": '; cat "$TMP/server_variables.json"; printf ',\n'
  printf '  "allocations": '; cat "$TMP/allocations.json"; printf ',\n'
  printf '  "nodes": '; cat "$TMP/nodes.json"; printf '\n'
  printf '}\n'
} >"$OUT"

printf '%s\n' "$OUT"
