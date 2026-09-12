#!/usr/bin/env bash
# TUI helpers for the Flutter panel installer (Charm gum).
# Sourced by ubuntu-24.04.sh. Expects log/warn/die from the caller.

GUM_VERSION="${FLUTTER_GUM_VERSION:-0.16.2}"
GUM_DIR="${FLUTTER_GUM_DIR:-/usr/local/lib/flutter-install}"
GUM="${GUM_DIR}/gum"
UI_TTY="/dev/tty"
RED=$'\033[1;31m'
DIM=$'\033[2m'
BOLD=$'\033[1m'
RESET=$'\033[0m'

ui_has_tty() {
  [[ -e "$UI_TTY" && -r "$UI_TTY" ]]
}

ui_gum_ready() {
  [[ -n "${GUM:-}" && -x "$GUM" ]] && ui_has_tty
}

ensure_gum() {
  if [[ -x "$GUM" ]]; then
    return 0
  fi
  if ! command -v curl >/dev/null 2>&1; then
    apt-get update -y >/dev/null
    apt-get install -y --no-install-recommends curl ca-certificates tar >/dev/null
  fi
  local arch gum_arch tmp tarball
  arch="$(dpkg --print-architecture 2>/dev/null || uname -m)"
  case "$arch" in
    amd64|x86_64) gum_arch=x86_64 ;;
    arm64|aarch64) gum_arch=arm64 ;;
    *)
      warn "No gum binary for CPU architecture ${arch}; using plain prompts."
      return 1
      ;;
  esac
  install -d -m 0755 "$GUM_DIR"
  tmp="$(mktemp -d)"
  tarball="${tmp}/gum.tgz"
  log "Downloading gum v${GUM_VERSION} (${gum_arch})"
  local ok=0
  local url
  for url in \
    "https://github.com/charmbracelet/gum/releases/download/v${GUM_VERSION}/gum_${GUM_VERSION}_Linux_${gum_arch}.tar.gz" \
    "https://github.com/charmbracelet/gum/releases/download/v0.16.2/gum_0.16.2_Linux_${gum_arch}.tar.gz"
  do
    if curl -fsSL "$url" -o "$tarball"; then
      ok=1
      break
    fi
  done
  if [[ "$ok" -ne 1 ]]; then
    rm -rf "$tmp"
    warn "Could not download gum; using plain prompts."
    return 1
  fi
  tar -xzf "$tarball" -C "$tmp"
  local found
  found="$(find "$tmp" -type f -name gum -print -quit)"
  if [[ -z "$found" ]]; then
    rm -rf "$tmp"
    warn "gum archive did not contain a gum binary; using plain prompts."
    return 1
  fi
  install -m 0755 "$found" "$GUM"
  rm -rf "$tmp"
}

ui_gum() {
  TERM="${TERM:-xterm-256color}" "$GUM" "$@" <"$UI_TTY"
}

ui_choose() {
  local header="$1"
  local selected="$2"
  shift 2
  local options=("$@")
  if ui_gum_ready; then
    local result=""
    result="$(
      ui_gum choose \
        --no-limit \
        --header "${header}  (↑/↓ move, space to select, enter to confirm)" \
        --cursor.foreground "#E11D48" \
        --header.foreground "#E11D48" \
        --selected.foreground "#FFFFFF" \
        --selected.background "#E11D48" \
        --selected "$selected" \
        "${options[@]}"
    )" || true
    if [[ -z "$result" ]]; then
      printf '%s\n' "$selected"
      return
    fi
    local last=""
    while IFS= read -r line; do
      [[ -n "$line" ]] && last="$line"
    done <<<"$result"
    printf '%s\n' "${last:-$selected}"
    return
  fi
  local i=1 choice=""
  printf '\n%s\n' "$header" >"$UI_TTY"
  for opt in "${options[@]}"; do
    if [[ "$opt" == "$selected" ]]; then
      printf '  %d) %s (default)\n' "$i" "$opt" >"$UI_TTY"
    else
      printf '  %d) %s\n' "$i" "$opt" >"$UI_TTY"
    fi
    i=$((i + 1))
  done
  if ui_has_tty; then
    read -r -p "Choice [${selected}]: " choice <"$UI_TTY" || true
  fi
  if [[ -z "$choice" ]]; then
    printf '%s\n' "$selected"
    return
  fi
  if [[ "$choice" =~ ^[0-9]+$ ]] && [[ "$choice" -ge 1 && "$choice" -le ${#options[@]} ]]; then
    printf '%s\n' "${options[$((choice - 1))]}"
    return
  fi
  printf '%s\n' "$choice"
}

ui_input() {
  local header="$1"
  local placeholder="$2"
  local value="${3:-}"
  local out=""
  if ui_gum_ready; then
    local args=(input --header "$header" --placeholder "$placeholder")
    if [[ -n "$value" ]]; then
      args+=(--value "$value")
    fi
    out="$(ui_gum "${args[@]}")" || true
    if [[ -z "$out" ]]; then
      out="$value"
    fi
    printf '%s\n' "$out"
    return
  fi
  local display="$header"
  if [[ -n "$value" ]]; then
    display="$header [$value]"
  fi
  if ui_has_tty; then
    read -r -p "${display}: " out <"$UI_TTY" || true
  fi
  printf '%s\n' "${out:-$value}"
}

ui_password() {
  local header="$1"
  local out=""
  if ui_gum_ready; then
    ui_gum input --password --header "$header" --placeholder "at least 10 characters"
    return
  fi
  if ui_has_tty; then
    read -r -s -p "${header}: " out <"$UI_TTY" || true
    printf '\n' >"$UI_TTY"
  fi
  printf '%s\n' "$out"
}

ui_confirm() {
  local header="$1"
  local default="${2:-Yes}"
  local answer
  answer="$(ui_choose "$header" "$default" "Yes" "No")"
  [[ "$answer" == "Yes" ]]
}

ui_phase() {
  local title="$1"
  printf '\n'
  if ui_gum_ready; then
    ui_gum style \
      --foreground 196 \
      --border-foreground 196 \
      --border double \
      --align center \
      --width 56 \
      --padding "1 2" \
      --bold \
      "$title"
    printf '\n'
    return
  fi
  printf '%s' "$RED$BOLD"
  printf '╔══════════════════════════════════════════════════════╗\n'
  printf '║  %-50s  ║\n' "$title"
  printf '╚══════════════════════════════════════════════════════╝\n'
  printf '%s' "$RESET"
  printf '\n'
}

ui_banner_flutter() {
  local art
  art="$(
    cat <<'EOF'
███████╗██╗     ██╗   ██╗████████╗████████╗███████╗██████╗
██╔════╝██║     ██║   ██║╚══██╔══╝╚══██╔══╝██╔════╝██╔══██╗
█████╗  ██║     ██║   ██║   ██║      ██║   █████╗  ██████╔╝
██╔══╝  ██║     ██║   ██║   ██║      ██║   ██╔══╝  ██╔══██╗
██║     ███████╗╚██████╔╝   ██║      ██║   ███████╗██║  ██║
╚═╝     ╚══════╝ ╚═════╝    ╚═╝      ╚═╝   ╚══════╝╚═╝  ╚═╝
EOF
  )"
  printf '\n'
  if ui_gum_ready; then
    ui_gum style --foreground 196 --bold --align center --padding "1 0" "$art"
    printf '\n'
    return
  fi
  printf '%s%s%s\n\n' "$RED$BOLD" "$art" "$RESET"
}

# ui_kv_table "Key" "Value" "Key" "Value" ...
ui_kv_table() {
  local rows=()
  local key_w=0
  local val_w=0
  local key value
  while [[ $# -ge 2 ]]; do
    key="$1"
    value="$2"
    shift 2
    rows+=("$key"$'\t'"$value")
    [[ ${#key} -gt $key_w ]] && key_w=${#key}
    [[ ${#value} -gt $val_w ]] && val_w=${#value}
  done
  [[ $key_w -lt 12 ]] && key_w=12
  [[ $val_w -lt 24 ]] && val_w=24
  [[ $val_w -gt 64 ]] && val_w=64
  local line=""
  local i
  local body=""
  body+="┌"
  for ((i = 0; i < key_w + 2; i++)); do body+="─"; done
  body+="┬"
  for ((i = 0; i < val_w + 2; i++)); do body+="─"; done
  body+=$'┐\n'
  for line in "${rows[@]}"; do
    key="${line%%$'\t'*}"
    value="${line#*$'\t'}"
    if [[ ${#value} -gt $val_w ]]; then
      value="${value:0:$((val_w - 1))}…"
    fi
    body+=$(printf '│ %-*s │ %-*s │\n' "$key_w" "$key" "$val_w" "$value")
    body+=$'\n'
  done
  body+="└"
  for ((i = 0; i < key_w + 2; i++)); do body+="─"; done
  body+="┴"
  for ((i = 0; i < val_w + 2; i++)); do body+="─"; done
  body+="┘"
  if ui_gum_ready; then
    ui_gum style --border rounded --border-foreground 196 --padding "1 1" --margin "1 0" "$body"
    return
  fi
  printf '%s\n' "$body"
}
