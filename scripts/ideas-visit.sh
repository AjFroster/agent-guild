#!/usr/bin/env bash
# Sends the daily ideas visitor (.claude/agents/visitor.md) on its tour as its own headless
# Claude, with a browser as its only tool, so it stays blind however the calling session
# is set up. Prints the visitor's report.
#
#   scripts/ideas-visit.sh "<brief: addresses, today's focus, where to start>"
set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
scratch=${TMPDIR:-/tmp}/agent-guild-ideas
mkdir -p "$scratch"

# The visitor's instructions are the agent file's body, without its frontmatter.
awk 'f >= 2 { print } /^---$/ { f++ }' "$root/.claude/agents/visitor.md" >"$scratch/visitor.md"
cat >"$scratch/mcp.json" <<JSON
{ "mcpServers": { "playwright": { "type": "stdio", "command": "$root/scripts/ideas-browser.sh" } } }
JSON

# Run from the scratch folder, not the repository, so no project settings, CLAUDE.md or
# skills reach it.
cd "$scratch"
claude -p "$1" \
  --append-system-prompt "$(cat "$scratch/visitor.md")" \
  --mcp-config "$scratch/mcp.json" --strict-mcp-config \
  --tools "" --allowedTools "mcp__playwright__*" \
  --model sonnet --output-format text
