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
  TERM="${TERM:-xterm-256color}" \
    COLORTERM="${COLORTERM:-truecolor}" \
    "$GUM" "$@" <"$UI_TTY"
}

ui_choose() {
  local header="$1"
  local selected="$2"
  shift 2
  local options=("$@")
  local count=${#options[@]}
  local idx=0 i key bracket arrow
  [[ "$count" -gt 0 ]] || return 1
  for i in "${!options[@]}"; do
    if [[ "${options[$i]}" == "$selected" ]]; then
      idx=$i
      break
    fi
  done

  if ! ui_has_tty; then
    printf '%s\n' "$selected"
    return
  fi

  local lines=0
  local WHITE=$'\033[1;97m'
  local MUTED=$'\033[0;97m'
  local HINT=$'\033[0;90m'
  _ui_radio_draw() {
    local i out=""
    out+=$'\n'
    out+="  ${WHITE}${header}${RESET}"$'\n'
    out+="  ${HINT}↑/↓ move · enter to confirm${RESET}"$'\n\n'
    for i in "${!options[@]}"; do
      if [[ $i -eq $idx ]]; then
        out+="  ${RED}●${RESET} ${WHITE}${options[$i]}${RESET}"$'\n'
      else
        out+="  ${HINT}○${RESET} ${MUTED}${options[$i]}${RESET}"$'\n'
      fi
    done
    printf '%s' "$out" >"$UI_TTY"
    lines=$((count + 4))
  }

  printf '\033[?25l' >"$UI_TTY"
  trap 'printf "\033[?25h" >"$UI_TTY"' RETURN
  _ui_radio_draw
  while true; do
    IFS= read -rsn1 key <"$UI_TTY" || true
    if [[ "$key" == $'\033' ]]; then
      IFS= read -rsn1 bracket <"$UI_TTY" || true
      IFS= read -rsn1 arrow <"$UI_TTY" || true
      if [[ "$bracket" == "[" ]]; then
        case "$arrow" in
          A) idx=$(((idx - 1 + count) % count)) ;;
          B) idx=$(((idx + 1) % count)) ;;
        esac
      fi
    elif [[ "$key" == "k" ]]; then
      idx=$(((idx - 1 + count) % count))
    elif [[ "$key" == "j" ]]; then
      idx=$(((idx + 1) % count))
    elif [[ "$key" == "" || "$key" == " " ]]; then
      break
    fi
    printf '\033[%sA\033[J' "$lines" >"$UI_TTY"
    _ui_radio_draw
  done
  printf '\033[?25h' >"$UI_TTY"
  printf '%s\n' "${options[$idx]}"
}

ui_input() {
  local header="$1"
  local placeholder="$2"
  local value="${3:-}"
  local out=""
  if ui_gum_ready; then
    local args=(
      input
      --header "$header"
      --placeholder "$placeholder"
      --header.foreground "#F9FAFB"
      --prompt.foreground "#F9FAFB"
      --placeholder.foreground "#9CA3AF"
      --cursor.foreground "#E11D48"
    )
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
    printf '\033[1;97m' >"$UI_TTY"
    read -r -p "${display}: " out <"$UI_TTY" || true
    printf '\033[0m' >"$UI_TTY"
  fi
  printf '%s\n' "${out:-$value}"
}

ui_password() {
  local header="$1"
  local out=""
  if ui_gum_ready; then
    ui_gum input \
      --password \
      --header "$header" \
      --placeholder "at least 10 characters" \
      --header.foreground "#F9FAFB" \
      --prompt.foreground "#F9FAFB" \
      --placeholder.foreground "#9CA3AF" \
      --cursor.foreground "#E11D48"
    return
  fi
  if ui_has_tty; then
    printf '\033[1;97m' >"$UI_TTY"
    read -r -s -p "${header}: " out <"$UI_TTY" || true
    printf '\033[0m\n' >"$UI_TTY"
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
    ui_gum style --foreground "#F9FAFB" --border rounded --border-foreground 196 --padding "1 1" --margin "1 0" "$body"
    return
  fi
  printf '%s\n' "$body"
}
