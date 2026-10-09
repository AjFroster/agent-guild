# Roadmap

Reviewed against `pixel-agents-hq/pixel-agents` (v1.4.1, open PR #347) and
`FulAppiOS/Agent-Quest` (main), 2026-09-30.

## Controlling agents from the UI

Neither repo ships it. Agent Quest is watch-only. Pixel Agents launches agents only as VS
Code terminals; its browser build "does not launch Claude for you", and browser launching
is open PR #347 (a server-side PTY per agent streamed to xterm.js).

agent-guild does it as chat instead of a terminal: each chat runs the user's own `claude`
CLI headless with stream-json in and out, and the browser shows streamed replies and tool
calls. Built at the owner's request, using their Claude login (their choice over an API
key with the Agent SDK; the SDK docs ask third-party products not to offer claude.ai
login, so the guild only ever drives the CLI the user already installed and logged in).

Not yet: live Allow/Deny for individual tool calls. Headless runs take a permission mode
instead; per-call approval needs the Agent SDK's `canUseTool` (API key) or a permission
MCP tool.

## Feature inventory

| Feature                                                   | From                  | Status                                             |
| --------------------------------------------------------- | --------------------- | -------------------------------------------------- |
| Live sessions, sub-agents as party members                | both                  | done                                               |
| Click a character / building for details                  | AQ                    | done                                               |
| Sound and toast on "finished" / "needs you"               | PA, AQ                | done                                               |
| Desktop notifications, settings panel                     | AQ                    | done                                               |
| First-run hint                                            | AQ                    | done                                               |
| Guild-wide activity feed with filters                     | AQ                    | next                                               |
| Token counts, session report card                         | AQ                    | done                                               |
| Loose ends: unpushed commits, uncommitted files           | none                  | done                                               |
| Cloud (claude.ai/code) sessions as heroes                 | none                  | open: internal API only, see below                 |
| Multiple `~/.claude*` directories                         | AQ                    | next                                               |
| Exact permission-wait signal                              | PA                    | done: the Herald mod (`mod/`)                      |
| Consent-gated hooks installer                             | PA                    | planned                                            |
| Agent teams (lead + teammates)                            | PA                    | done: the King commands Knights                    |
| Skills Archive: librarians find and review, user installs | none                  | done                                               |
| Village editor, saved layouts, project districts          | PA, AQ                | planned                                            |
| Codex sessions                                            | AQ                    | planned                                            |
| Start, chat with, stop and resume sessions from the UI    | PA (VS Code), PA #347 | done (as chat)                                     |
| Approve or deny individual tool calls from the UI         | none                  | not yet: needs an API key or a permission MCP tool |
| Scheduled sessions (Town Crier daily report)              | none                  | done                                               |
| Minimap                                                   | AQ                    | not needed: the whole village fits on screen       |
| LAN mode                                                  | AQ, PA                | not planned: stays on loopback                     |
| External asset packs                                      | PA                    | not planned: art licensing                         |
| VS Code extension                                         | PA                    | not planned                                        |

PA = Pixel Agents, AQ = Agent Quest.

## Cloud sessions

Sessions on claude.ai/code run in Anthropic's cloud, so their transcripts never reach
`~/.claude/projects`. The `claude` CLI lists them through an internal beta API signed in
with the user's claude.ai login. The guild would have to read that login to do the same,
which the rule above (only drive the CLI the user installed) rules out until there is a
supported way. Remote Control sessions run on the user's machine and already show up.
