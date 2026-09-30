# agent-guild

Claude Code sessions shown as an RPG guild. Heroes are sessions, party members are
sub-agents, quests are todo items, and XP comes from finished quests and turns.

## Layout

- `core/`: the event schema (zod) and the game rules. Pure functions, no I/O. Most unit
  tests live here.
- `web/`: React + a plain canvas village, built with Vite. `?demo=<fixture>&t=<seconds>`
  replays `fixtures/<fixture>.json` frozen at that second.
- `fixtures/`: recorded event streams. **Fictional names and titles only.** Never commit
  real prompts, paths or usernames.
- `server/`: Fastify on 127.0.0.1 with a per-run token. `watcher.ts` follows
  `~/.claude/projects/**.jsonl` read-only; `core/src/transcript.ts` decides what crosses
  over (tool names, todos, turn ends) and drops everything else. Keep it that way.
- `web/e2e/transcripts/`: fake transcripts the live browser test runs against.

## Workflow

- Every change goes on a branch (`feat/`, `fix/`, `chore/`, ...) and lands through a PR.
  `main` is protected. PR titles are Conventional Commits because PRs are squash-merged.
- CI runs on every PR: checks (types, lint, format, unit tests), build, and browser tests.
  The browser job posts screenshots on the PR. Look at them before merging.

## Checking UI changes

After changing anything visible, check it in the browser with `playwright-cli` before
committing:

    npm run build -w web && (cd web && npx vite preview &)
    playwright-cli open --browser=chromium "http://127.0.0.1:5281/?demo=party&t=20"
    playwright-cli find "needs you"
    playwright-cli console        # must show no errors
    playwright-cli close

If the change needs a new state on screen, add or extend a fixture and a `capture()` in
`web/e2e/guild.spec.ts` so CI shows it on the PR.

## Commands

    npm test            # unit tests (vitest)
    npm run typecheck
    npm run lint
    npm run format
    npm start           # build web, serve it live on 127.0.0.1:4747
    npm run e2e         # Playwright: demo mode plus the real server on fake transcripts
