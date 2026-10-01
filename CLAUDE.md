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
  over (tool names, todos, turn ends, token counts, that a message arrived) and drops everything else. Keep it
  that way. `server/src/git.ts` polls session folders read-only and sends counts only (unpushed
  commits, uncommitted files): never file names or commit messages.
- `web/e2e/transcripts/`: fake transcripts the live browser test runs against.
- Chats: `server/src/chats.ts` runs `claude -p` (stream-json in and out) per active chat
  and resumes by session id; `core/src/chat.ts` turns its output and saved transcripts
  into chat items; `server/src/chatRoutes.ts` holds every control route, each behind the
  token. `server/src/crier.ts` is the Town Crier scheduler.
- The King: `server/src/king.ts` (Court: the rules for orders), `kingRoutes.ts` (the
  `/api/king` routes) and `kingMcp.ts` (the stdio MCP server the King's CLI runs, one tool
  per route). Ranks and team colours live in `core/src/game.ts` (`rankOf`) and
  `web/src/village.ts`.
- The Library: `server/src/skills.ts` lists installed skills (read-only), `archive.ts` keeps
  the reviewed skills, `library.ts` schedules the Scout and the Reviewer (each with its own
  MCP tools in `kingMcp.ts`, chosen by `GUILD_ROLE`), `install.ts` installs a reviewed
  commit on the user's approval only, `libraryRoutes.ts` holds the routes (and refuses
  candidates below the user's star threshold). `web/src/library.tsx` is the Library page
  (`?page=library`, opened by clicking the Library): a Tiny Swords scene drawn by
  `libraryScene.ts` on `SceneCanvas.tsx`, then parchment cards. The librarians are not drawn
  on the map but as signs over the Library's roof (`drawLibrarySigns`). Tests never
  touch the real `~/.claude`: `CLAUDE_SKILLS_DIR` and `AGENT_GUILD_SKILL_GIT_BASE` point
  them at temporary folders and local repositories.
- `web/e2e/fake-claude.mjs` stands in for the CLI in browser tests, and plays a scripted
  King over the real MCP server when given `--mcp-config`. Never call the real
  `claude` from tests: CI has no login, and it would spend the user's usage.
- Building pages: `web/src/scene.ts` is the shared kit (art list `ART`, `put`, `terrain`,
  `nine`, `ribbon`), `SceneCanvas.tsx` draws any scene and hit-tests clicks. A scene module
  keeps a pure model and pick function (unit-tested) beside its draw function. Art comes
  from Tiny Swords (`web/public/assets/tiny-swords/`, CC0, see its CREDITS) or, for what the
  pack lacks, the guild's own props drawn in its style by `scripts/art/props.py`
  (`web/public/assets/props/`). How to add one: `docs/BUILDING-PAGES.md`.
- `web/src/village.ts`: pure drawing and hit-testing. `VillageCanvas.tsx` owns the
  animation loop; `panels.tsx` the side panels; `selection.ts` keeps the open panel in
  `?select=`. Interaction tests click canvas coordinates taken from the layout in
  `village.ts`, so moving a building means updating `web/e2e/interact.spec.ts`.

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
