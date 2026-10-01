#!/usr/bin/env bash
# Start Agent Guild automatically on Windows + WSL, so it is running (and the Town Crier
# fires) without a terminal open.
#
#   scripts/autostart-wsl.sh install [port]   default port 4760
#   scripts/autostart-wsl.sh uninstall
#   scripts/autostart-wsl.sh link             print the guild's link
#
# What install does, all reversible with `uninstall`:
#   1. A systemd user service, ~/.config/systemd/user/agent-guild.service, that builds the
#      web app and runs the server from this checkout. Needs `systemd=true` in
#      /etc/wsl.conf.
#   2. `loginctl enable-linger`, so the service runs without an open login session.
#   3. "Agent Guild WSL keep-alive.vbs" in the Windows Startup folder, which starts a
#      hidden, idle WSL process at Windows sign-in. Without it, WSL shuts the distro down
#      a few seconds after the last terminal closes, and the service with it. (A Startup
#      script rather than a scheduled task, because logon tasks need administrator rights.)
set -euo pipefail

SERVICE=agent-guild.service
KEEPALIVE="Agent Guild WSL keep-alive.vbs"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UNIT_DIR="$HOME/.config/systemd/user"
DATA_DIR="${AGENT_GUILD_DATA_DIR:-$HOME/.agent-guild}"

die() { printf 'error: %s\n' "$*" >&2; exit 1; }

# The Windows Startup folder, as a WSL path, or empty when not on WSL.
startup_dir() {
  command -v cmd.exe >/dev/null || return 0
  local appdata
  appdata="$(cmd.exe /c 'echo %APPDATA%' 2>/dev/null | tr -d '\r')"
  if [[ -n "$appdata" ]]; then
    wslpath "$appdata\\Microsoft\\Windows\\Start Menu\\Programs\\Startup"
  fi
}

link() {
  local port
  port=$(systemctl --user show "$SERVICE" -p Environment --value 2>/dev/null | tr ' ' '\n' | sed -n 's/^AGENT_GUILD_PORT=//p')
  [[ -f "$DATA_DIR/token" ]] || die "no token yet; is the service running? (systemctl --user status $SERVICE)"
  printf 'http://127.0.0.1:%s/?token=%s\n' "${port:-4760}" "$(tr -d '\n' < "$DATA_DIR/token")"
}

install() {
  local port="${1:-4760}"
  [[ "$port" =~ ^[0-9]+$ ]] || die "port must be a number"
  [[ "$(ps -p 1 -o comm=)" == systemd ]] || die "systemd is not running; add [boot] systemd=true to /etc/wsl.conf and restart WSL"
  local node npm claude
  node="$(command -v node)" || die "node not found on PATH"
  npm="$(command -v npm)" || die "npm not found on PATH"
  claude="$(command -v claude || true)"
  [[ -n "$claude" ]] || printf 'warning: claude not found on PATH; chats will fail until it is installed\n' >&2

  # PATH is fixed into the unit because systemd does not read shell profiles, where nvm
  # and ~/.local/bin usually get added.
  local path_dirs
  path_dirs="$(dirname "$node"):$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin"

  mkdir -p "$UNIT_DIR"
  cat > "$UNIT_DIR/$SERVICE" <<UNIT
[Unit]
Description=Agent Guild (Claude Code sessions as an RPG guild)
After=network-online.target

[Service]
WorkingDirectory=$REPO
Environment=PATH=$path_dirs
Environment=AGENT_GUILD_PORT=$port
ExecStartPre=$npm run build -w web
ExecStart=$node server/src/cli.ts
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
UNIT

  systemctl --user daemon-reload
  systemctl --user enable --now "$SERVICE"
  loginctl enable-linger "$USER"

  local startup
  startup="$(startup_dir)"
  if [[ -n "$startup" && -d "$startup" ]]; then
    local distro="${WSL_DISTRO_NAME:-Ubuntu}"
    # Window style 0 = hidden; `sleep infinity` keeps the distro alive while signed in.
    printf 'CreateObject("WScript.Shell").Run "wsl.exe -d %s --exec sleep infinity", 0, False\r\n' "$distro" \
      > "$startup/$KEEPALIVE"
    # Start it now too, so the guild survives closing this terminal before the next
    # sign-in; but only once, since re-running install should not stack keep-alives.
    if pgrep -xf 'sleep infinity' >/dev/null; then
      printf 'Keep-alive added to the Windows Startup folder (one is already running).\n'
    else
      (cd "$startup" && wscript.exe "$KEEPALIVE")
      printf 'Keep-alive added to the Windows Startup folder and started.\n'
    fi
  else
    printf 'note: no Windows Startup folder found; skipped the keep-alive\n'
  fi

  printf 'Waiting for the guild to answer'
  for _ in $(seq 1 60); do
    if curl -sf "http://127.0.0.1:$port/api/health" >/dev/null; then
      printf '\nAgent Guild is running and will start at login.\n'
      link
      return
    fi
    printf '.'
    sleep 1
  done
  die "the service did not answer on port $port; see: journalctl --user -u $SERVICE -n 50"
}

uninstall() {
  systemctl --user disable --now "$SERVICE" 2>/dev/null || true
  rm -f "$UNIT_DIR/$SERVICE"
  systemctl --user daemon-reload
  local startup
  startup="$(startup_dir)"
  [[ -n "$startup" ]] && rm -f "$startup/$KEEPALIVE"
  printf 'Removed the service and the Startup keep-alive. Lingering was left on (loginctl disable-linger %s to undo).\n' "$USER"
  printf 'The keep-alive WSL process stops at the next Windows sign-out or "wsl --shutdown".\n'
}

case "${1:-}" in
  install) install "${2:-}" ;;
  uninstall) uninstall ;;
  link) link ;;
  *) sed -n '2,8p' "$0" | sed 's/^# \{0,1\}//'; exit 2 ;;
esac
