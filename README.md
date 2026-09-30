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

## Status

- [x] Game rules, demo replay, CI with screenshots on every PR
- [x] Live sessions from Claude Code transcripts (read-only, 127.0.0.1, token)
- [ ] Permission prompts as "needs you" (needs Claude Code hooks, opt-in)
- [ ] Visual regression baselines
