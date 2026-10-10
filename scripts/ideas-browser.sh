#!/usr/bin/env bash
# The daily ideas visitor's only tool: a Playwright MCP browser (.claude/agents/visitor.md).
# Uses the Chromium the cloud image ships when it is there, so nothing is downloaded.
set -euo pipefail
args=(--headless --isolated --viewport-size "1280,800" --output-dir "${TMPDIR:-/tmp}/agent-guild-ideas/shots")
if [ -x /opt/pw-browsers/chromium ]; then
  args+=(--executable-path /opt/pw-browsers/chromium)
fi
# Chromium refuses its sandbox as root, which is how cloud containers run.
if [ "$(id -u)" = 0 ]; then
  args+=(--no-sandbox)
fi
exec npx -y @playwright/mcp@0.0.83 "${args[@]}"
