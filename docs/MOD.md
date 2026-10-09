# The Herald: Agent Kingdom as a Claude Code mod

The Herald is a Claude Code mod (a plugin of function hooks) that brings the guild into each
Claude Code session. The village, the server and the King stay as they are (`npm start`);
the mod is the guild's presence inside every session:

- it tells the guild **the moment a session waits on a permission prompt**, which the
  transcript watcher cannot see (today only `AskUserQuestion` sets "needs you");
- it shows the session's own hero in the **status line** (rank, level, XP);
- it adds a **`/guild`** command that says whether the guild is up and puts the village link
  on the clipboard;
- it raises a **toast** when the hero levels up.

It is public: anyone can install it with

    /plugin install agent-kingdom --marketplace AjFroster/agent-guild

so it is held to the goals below, each checked by a command or a test.

## Rules the mod never breaks

- **It sends the guild a session id and a kind, nothing else.** No prompt text, tool input,
  file paths, commands or usernames ever leave the session through the mod.
- **It never blocks or changes the session.** Every hook passes the event on with `next(e)`
  unchanged; no hook denies, rewrites or delays a tool call, prompt or permission. Network
  calls have a short timeout and every failure is swallowed (the guild being down is normal).
- **It talks only to the guild on loopback** (`127.0.0.1` / `localhost` / `::1`). Any other
  configured address is refused.
- **The token never reaches the model or the transcript.** It is read from
  `~/.agent-guild/token` (or the configured path), sent only as `Authorization: Bearer`, and
  never put in a command's text, a toast, the status line or a log line.

## Goals

Each goal is done when every check under it passes. `npm run mod:check` runs the mod's checks.

### G1. The guild accepts signals (server, core)

- `POST /api/signal` takes `{ session, kind }`, `kind` one of `permission` or `cleared`.
  `session` is validated (1 to 100 characters of `[A-Za-z0-9_-]`); anything else is a 400.
- It sits behind the token (`guard` in `server/src/routes.ts`): 401 without it.
- It works in watch-only mode (`AGENT_GUILD_NO_CONTROL=1`) too: it only changes what is shown.
- `permission` publishes the existing `needs_input` event; `cleared` publishes a new
  `cleared` event, which `core/src/game.ts` turns from `needs_you` back to `working`
  (and leaves any other status alone). A signal for a session the guild does not know is
  ignored with a 204, never creates a hero.
- Body limit is small (1 KB). Checks: unit tests in `core` for the `cleared` event and in
  `server` for 204, 400 (bad kind, bad id, extra fields), 401, unknown session.

### G2. The guild answers "who am I" (server)

- `GET /api/hero/:session` (behind the token) returns `{ name, rank, level, xp, status }`
  for a known session, 404 otherwise, 400 for an invalid id. Nothing else about the hero.
- Checks: server tests for 200, 404, 400, 401.

### G3. The mod (`mod/`)

- `mod/.claude-plugin/plugin.json` (name `agent-kingdom`, version, description, author,
  `userConfig` for the guild URL, default `http://127.0.0.1:4747`, and the token file path),
  `mod/hooks/hooks.json`, `mod/hooks/register.ts`.
- `classic.PermissionRequest` sends `permission`. The next `tool.call` result, `prompt.submit`
  or `turn.complete` after it sends `cleared` once (not on every call).
- The status line shows `⚔ <Rank> · Lv <level> · <xp> XP`, refreshed at session start, on
  `turn.complete` and at most every 30 s; cleared when the guild is unreachable.
- A level higher than the last one seen raises one toast.
- `/guild` answers whether the guild is reachable and the hero's line, and copies the link
  with the token to the clipboard with `$.ui.copy`; the command's text never holds the token.
- Checks: `claude plugin validate mod` passes with no errors, and every gating hook it lists
  has a `.catch` that passes the event on (`next(e)`), so a failing hook can never refuse anything;
  `tsc` type-checks the mod; `claude plugin test mod` passes.

### G4. The mod's tests (`mod/hooks/*.test.ts`)

At least one test for each of: permission sends exactly one POST with only `{session, kind}`;
cleared is sent once after a permission and never without one; every hook calls `next` and
returns its result unchanged; a guild that is down (fetch rejects, times out, 500) changes
nothing and throws nothing; a non-loopback URL is refused and nothing is sent; the token
never appears in any text, toast, status or command output; the status line format; the
level-up toast fires once; `/guild` with the guild up and down.

### G5. Install and CI

- `.claude-plugin/marketplace.json` at the repository root lists `agent-kingdom` with
  `"source": "./mod"`; `claude plugin validate .` passes.
- `npm run mod:check` (root `package.json`) runs validate, the type-check and the mod tests.
- CI runs `npm run mod:check` with a pinned Claude Code CLI and no login. If the CLI cannot
  run those checks without a login, CI runs the type-check alone and this file says why.
- The mod is excluded from or passes the repo's lint and format checks.

### G6. Docs

- README: what the Herald does and the install line.
- `docs/ROADMAP.md`: "exact permission-wait signal" marked done.
- `CLAUDE.md` Layout: one line for `mod/`.

### G7. Nothing else breaks

`npm test`, `npm run typecheck`, `npm run lint`, `npm run format:check` all pass, with at
least as many unit tests as before (225).

## How it is built

Three agents, defined in `.claude/agents/` so the next change to the mod gets the same:

1. **mod-dev** builds against the goals until each check passes.
2. Then, in parallel:
   - **mod-tester** sanity-tests it: runs every check, tries the mod's edges (guild down,
     wrong token, odd ids, repeated signals), adds the tests G4 is missing, and reports a
     pass/fail per goal.
   - **mod-qa** is the code safety analysis: read-only, it checks the rules above
     (what leaves the session, loopback only, the token, never blocking) and the server
     routes for input validation and auth, and reports findings by severity.
3. mod-dev fixes every failed check and every high or medium finding, and the two run again,
   until both come back clean (at most three rounds).
