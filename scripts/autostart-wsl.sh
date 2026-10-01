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
#   3. A Windows scheduled task, "Agent Guild WSL keep-alive", that starts a hidden,
#      idle WSL process at Windows logon. Without it, WSL shuts the distro down a few
#      seconds after the last terminal closes, and the service with it.
set -euo pipefail

SERVICE=agent-guild.service
TASK="Agent Guild WSL keep-alive"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UNIT_DIR="$HOME/.config/systemd/user"
DATA_DIR="${AGENT_GUILD_DATA_DIR:-$HOME/.agent-guild}"

die() { printf 'error: %s\n' "$*" >&2; exit 1; }

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

  if command -v schtasks.exe >/dev/null; then
    local distro="${WSL_DISTRO_NAME:-Ubuntu}"
    # PowerShell starts wsl.exe hidden; `sleep infinity` keeps the distro alive.
    local action="powershell.exe -NoProfile -WindowStyle Hidden -Command Start-Process wsl.exe -WindowStyle Hidden -ArgumentList '-d','$distro','--exec','sleep','infinity'"
    schtasks.exe /Create /F /TN "$TASK" /SC ONLOGON /RL LIMITED /TR "$action" >/dev/null
    schtasks.exe /Run /TN "$TASK" >/dev/null
    printf 'Windows task "%s" created and started.\n' "$TASK"
  else
    printf 'note: not on WSL with Windows interop; skipped the keep-alive task\n'
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
  if command -v schtasks.exe >/dev/null; then
    schtasks.exe /Delete /F /TN "$TASK" >/dev/null 2>&1 || true
  fi
  printf 'Removed the service and the Windows task. Lingering was left on (loginctl disable-linger %s to undo).\n' "$USER"
  printf 'The keep-alive WSL process stops at the next Windows sign-out or `wsl --shutdown`.\n'
}

case "${1:-}" in
  install) install "${2:-}" ;;
  uninstall) uninstall ;;
  link) link ;;
  *) sed -n '2,8p' "$0" | sed 's/^# \{0,1\}//'; exit 2 ;;
esac
