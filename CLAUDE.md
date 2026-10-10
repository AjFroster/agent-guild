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
- The Forge (docs/FORGE.md): `server/src/forge.ts` keeps the orders, runs the Blacksmith (a
  read-only session in the asking Knight's project) and then the Library's Reviewer, and
  installs a reviewed piece into the project's `.claude/` on the user's click only;
  `forgeRoutes.ts` holds its routes. Every Knight the guild starts gets the `knight` MCP role
  (`request_equipment`), told apart by its folder. `web/src/forge.tsx` and `forgeScene.ts`
  are its page.
- The Tower (docs/TOWER.md): `server/src/ports.ts` is the Portal Keeper: it finds what the
  user's own processes listen on (Linux/WSL `/proc`, macOS `lsof`), read-only, checks once
  with a GET whether each is a website, and sends the page the port, program, folder name
  and Knight only; `portalRoutes.ts` holds its routes. `web/src/tower.tsx` and
  `towerScene.ts` are its page.
- The War Room (docs/WARS.md): `core/src/wars.ts` holds the rules (battles from branches,
  states, the clearing guards, the dispatch); `server/src/wars.ts` reads git and `gh` (pull
  request states and checks only, never titles), makes a worktree per battle and clears
  won ones only past every guard; `warRoutes.ts` holds its routes. `web/src/wars.tsx`,
  `campScene.ts` (the War Camp), `fieldScene.ts` (one war's battlefield) and `duel.ts`
  (Knights against the pack's goblins) are its page, `warBanners.ts` the war colours on the map. Browser tests use
  `web/e2e/fake-gh.mjs`, never the real `gh`.
- Shared foundations for every utility (docs/BUILDING-PAGES.md, "Adding a utility"):
  `server/src/routes.ts` (`guard`: the token check on every control route),
  `mcpConfig.ts` (`writeMcpConfig` for each MCP role), `jsonStore.ts` (the queued, atomic,
  private JSON file behind the Archive and the Forge). Helper sessions start with
  `helper: true` (their own pool; closed after each turn). `web/src/decisions.ts` and
  `inbox.tsx` are the Needs-you tab: everything waiting on the user in one list.
- The Herald (docs/MOD.md): `mod/` is the Claude Code mod (`agent-kingdom`, a plugin of
  function hooks, listed by `.claude-plugin/marketplace.json`) that posts `/api/signal` and
  reads `/api/hero/:session` (`server/src/heraldRoutes.ts`); `npm run mod:check` validates,
  type-checks (against the API types Claude Code lays in `mod/.claude-plugin/types/` once
  it has loaded the mod; skipped where they are missing, as in CI) and tests it. The agents in
  `.claude/agents/` (mod-dev, mod-tester, mod-qa) build and check it.
- `npm run rehearse` (`scripts/rehearse.ts`): a free preflight of the CLI flags and MCP
  roles; `-- --live` runs each utility once on the real `claude` (the user runs it: it
  spends usage). Never from CI or tests.
- Building pages: `web/src/scene.ts` is the shared kit (art list `ART`, `put`, `terrain`,
  `nine`, `ribbon`, `plate`, `highlight`), `BuildingPage.tsx` is every page's shell, and
  `SceneCanvas.tsx` draws any scene and hit-tests clicks. A scene module
  keeps a pure model and pick function (unit-tested) beside its draw function. Art comes
  from Tiny Swords (`web/public/assets/tiny-swords/`, CC0, see its CREDITS) or, for what the
  pack lacks, the guild's own props drawn in its style by `scripts/art/props.py`
  (`web/public/assets/props/`). How to add one: `docs/BUILDING-PAGES.md`.
- Themes: `web/src/styles.css` is the Classic look; `web/src/themes.css` repaints everything
  that is not the village (Control Room, the default; Telemetry; Hazard) on `<html data-theme>`,
  chosen in Settings behind the gear button (`settings.ts`, `chrome.tsx`). Fonts are bundled
  (`web/src/fonts.ts`). A new panel or form should use the shared classes so every theme reaches
  it; `web/e2e/themes.spec.ts` checks each theme.
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
`web/e2e/guild.spec.ts` (or `shoot()` from `web/e2e/shots.ts`) so CI shows it on the PR. On a PR,
CI takes only the shots for the screens its changes reach: `scripts/import-graph.ts` follows each
changed module through its importers to the areas in `web/e2e/shot-areas.ts`
(`scripts/shot-select.ts`), and `shoot()` skips the rest (`GUILD_SHOTS`, `GUILD_SHOT_THEMES`).
Every theme is taken only when a theme file changed, posted side by side
(`scripts/shot-table.ts`). A new shot or page needs a place in that map;
`scripts/shot-select.test.ts` fails until it has one. The `screenshots: all` label takes all.

## Commands

    npm test            # unit tests (vitest)
    npm run typecheck
    npm run lint
    npm run format
    npm start           # build web, serve it live on 127.0.0.1:4747
    npm run e2e         # Playwright: demo mode plus the real server on fake transcripts
