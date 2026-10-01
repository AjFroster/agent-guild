# agent-guild

Your Claude Code sessions as an RPG guild. Sessions are heroes, sub-agents are party
members, and todos are quests that earn XP. A beacon lights up when an agent is waiting
on you.

Local-first and read-only. It follows the transcripts Claude Code already writes to
`~/.claude/projects/` and never changes your Claude settings. Only tool names, todo
titles and turn ends leave the transcript; prompts, file contents and replies are dropped
while it reads.

## Run it

```bash
npm ci
npm start
```

Open the link it prints (`http://127.0.0.1:4747/?token=…`). The token is new every run,
and the server only listens on 127.0.0.1.

| Variable                    | Default              |                                                                |
| --------------------------- | -------------------- | -------------------------------------------------------------- |
| `AGENT_GUILD_PORT`          | `4747`               |                                                                |
| `AGENT_GUILD_MAX_AGE_HOURS` | `3`                  | sessions older than this are not loaded at startup (`0` = all) |
| `AGENT_GUILD_IDLE_MINUTES`  | `20`                 | a silent session leaves the guild after this (`0` = never)     |
| `CLAUDE_PROJECTS_DIR`       | `~/.claude/projects` |                                                                |

Recorded demos need no server: `npm run dev`, then `http://127.0.0.1:5280/?demo=party`.

## How it maps

| Claude Code                                             | Guild                                |
| ------------------------------------------------------- | ------------------------------------ |
| Session                                                 | Hero, named after its project folder |
| Sub-agent                                               | Party member                         |
| Read/Grep/Glob · Edit/Write · Bash · WebFetch/WebSearch | Library · Forge · Arena · Tower      |
| TodoWrite items                                         | Quests; each finished quest is 50 XP |
| Finished turn                                           | 10 XP, back to the Guildhall         |
| AskUserQuestion                                         | "Needs you" beacon                   |

## Using it

- **Click a hero** to see that session: what it is doing now, its project branch and
  model, party members, quests, which buildings it spends its time in, and its latest tool
  calls.
- **Click a building** to see who is there now, which tools send heroes there, and the
  latest activity inside.
- Everything on the map can also be opened from the side panel with the keyboard.
  `Esc`, or clicking open grass, goes back to the guild.
- **Notices**: a toast and a short chime when a session needs you or finishes a turn.
  Click the toast to open that session. **Settings** turns the sound, "finished" and
  join/leave notices on or off, and can add desktop notifications while the tab is in the
  background. Settings are saved in your browser.
- A selection lives in the URL (`?select=hero:<id>` or `?select=building:forge`), so a
  reload keeps it.

## Status

- [x] Game rules, demo replay, CI with screenshots on every PR
- [x] Live sessions from Claude Code transcripts (read-only, 127.0.0.1, token)
- [x] Pixel-art village; clickable heroes and buildings with detail panels
- [x] Notices: toasts, sound, desktop notifications, settings
- [ ] Starting and driving agents from the UI: designed (see docs/ROADMAP.md), not built
- [ ] Permission prompts as "needs you" (needs Claude Code hooks, opt-in)
- [ ] Visual regression baselines

## Credits

Pixel art from [Tiny Swords](https://pixelfrog-assets.itch.io/tiny-swords) by Pixel Frog
(CC0), and building art from [Agent Quest](https://github.com/FulAppiOS/Agent-Quest) (MIT).
Details in `web/public/assets/tiny-swords/CREDITS.md`.
