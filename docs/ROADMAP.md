# Roadmap

Reviewed against `pixel-agents-hq/pixel-agents` (v1.4.1, open PR #347) and
`FulAppiOS/Agent-Quest` (main), 2026-09-30.

## Controlling agents from the UI

Neither repo ships it. Agent Quest is watch-only. Pixel Agents launches agents only as VS
Code terminals; its browser build "does not launch Claude for you", and launching and
typing from the browser is open PR #347 (a server-side PTY per agent, streamed to xterm.js,
gated by the token).

The same design was drafted here (terminal manager, token-gated control routes, launch
folders confined to `$HOME`) and is **not merged**: it lets this web page start coding
agents on the machine, which needs the owner's explicit decision first. The draft is in a
local git stash, not in this repo.

## Feature inventory

| Feature                                                     | From                  | Status                                       |
| ----------------------------------------------------------- | --------------------- | -------------------------------------------- |
| Live sessions, sub-agents as party members                  | both                  | done                                         |
| Click a character / building for details                    | AQ                    | done                                         |
| Sound and toast on "finished" / "needs you"                 | PA, AQ                | done                                         |
| Desktop notifications, settings panel                       | AQ                    | done                                         |
| First-run hint                                              | AQ                    | done                                         |
| Guild-wide activity feed with filters                       | AQ                    | next                                         |
| Token counts, session report card                           | AQ                    | next                                         |
| Multiple `~/.claude*` directories                           | AQ                    | next                                         |
| Consent-gated hooks installer; exact permission-wait signal | PA                    | planned                                      |
| Agent teams (lead + teammates)                              | PA                    | planned                                      |
| Village editor, saved layouts, project districts            | PA, AQ                | planned                                      |
| Codex sessions                                              | AQ                    | planned                                      |
| Launch / type / stop / resume agents from the UI            | PA (VS Code), PA #347 | awaiting decision                            |
| Approve or deny permissions from the UI                     | none                  | awaiting decision                            |
| Minimap                                                     | AQ                    | not needed: the whole village fits on screen |
| LAN mode                                                    | AQ, PA                | not planned: stays on loopback               |
| External asset packs                                        | PA                    | not planned: art licensing                   |
| VS Code extension                                           | PA                    | not planned                                  |

PA = Pixel Agents, AQ = Agent Quest.
