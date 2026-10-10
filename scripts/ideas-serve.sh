#!/usr/bin/env bash
# Serves the guild for the daily ideas visitor (.claude/skills/daily-ideas): the demo build
# on 5281 and the real server on 4748, following the browser tests' fake transcripts and
# using fake-claude and fake-gh, so a tour never calls the real `claude` or `gh`.
#
#   scripts/ideas-serve.sh        start both, wait until they answer, print the addresses
#   scripts/ideas-serve.sh stop   stop them
set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
scratch=${TMPDIR:-/tmp}/agent-guild-ideas
pids=$scratch/pids
demo_port=5281
live_port=4748
token=ideas-token-0123456789abcdef

stop() {
  if [ -f "$pids" ]; then
    while read -r pid; do kill "$pid" 2>/dev/null || true; done <"$pids"
    rm -f "$pids"
  fi
}

if [ "${1:-}" = stop ]; then
  stop
  exit 0
fi

stop
rm -rf "$scratch"
mkdir -p "$scratch"
projects=$scratch/projects
home=$scratch/home
remotes=$scratch/remotes

cd "$root/web"
[ -d "$root/node_modules" ] || (cd "$root" && npm ci --no-audit --no-fund)
npx vite build >"$scratch/build.log" 2>&1

cp -r e2e/transcripts "$projects"
mkdir -p "$home/proj" "$home/.agent-guild" "$home/fake-gh"
echo '{"enabled":false}' >"$home/.agent-guild/town-crier.json"
node e2e/make-skill-repo.mjs "$remotes" >/dev/null

nohup npx vite preview --port "$demo_port" --strictPort >"$scratch/demo.log" 2>&1 &
echo $! >>"$pids"

AGENT_GUILD_PORT=$live_port \
  AGENT_GUILD_TOKEN=$token \
  CLAUDE_PROJECTS_DIR=$projects \
  AGENT_GUILD_CLAUDE=$root/web/e2e/fake-claude.mjs \
  AGENT_GUILD_HOME=$home \
  AGENT_GUILD_DATA_DIR=$home/.agent-guild \
  AGENT_GUILD_MAX_AGE_HOURS=0 \
  AGENT_GUILD_IDLE_MINUTES=0 \
  CLAUDE_SKILLS_DIR=$home/.claude/skills \
  CLAUDE_PLUGINS_DIR=$home/.claude/plugins \
  AGENT_GUILD_SKILL_GIT_BASE=file://$remotes/ \
  FAKE_SKILL_REPO=$remotes/acme-labs/agent-skills.git \
  AGENT_GUILD_GH=$root/web/e2e/fake-gh.mjs \
  FAKE_GH_DIR=$home/fake-gh \
  nohup node ../server/src/cli.ts >"$scratch/live.log" 2>&1 &
echo $! >>"$pids"

for _ in $(seq 60); do
  if curl -fs "http://127.0.0.1:$demo_port/" >/dev/null && curl -fs "http://127.0.0.1:$live_port/api/health" >/dev/null; then
    fixtures=()
    for f in "$root"/fixtures/*.json; do fixtures+=("$(basename "$f" .json)"); done
    echo "Demo: http://127.0.0.1:$demo_port/?demo=<fixture>&t=<seconds>  (fixtures: ${fixtures[*]})"
    echo "Live: http://127.0.0.1:$live_port/?token=$token"
    exit 0
  fi
  sleep 1
done
echo "The guild did not start; logs are in $scratch" >&2
stop
exit 1
