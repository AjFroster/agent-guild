# Sharpening the guild's workflows

Branch `refactor/sharpen-workflows`. No new buildings, no new wizards: make the four
utilities we have (the King, the Library, the Forge, the Tower) work as one tool, prove
them on the real `claude`, and fix the base before the next utilities copy it again.

## Status

All five phases are built on this branch, one commit each (A, B, C in two, D in two, E),
every one green: 225 unit tests and 41 browser tests.

- **A.** `npm run rehearse` passes its free preflight on the real CLI (every flag and
  permission mode accepted, all six MCP roles answer). The live run passes every step on
  the stand-in; **its first real run is yours** (`npm run rehearse -- --live`): it spends
  usage, so no test or CI ever runs it.
- **B.** The **Needs you** tab, its badge, and toasts for a newly reviewed skill or forged
  piece. `decisions()` lives in `web/src/decisions.ts` rather than `core`, since skills and
  orders are web types.
- **C.** Project skills in every list; the Blacksmith asks the Library first ("Already in
  the Library"); helpers in their own pool, closed after each turn; ravens, not orders.
  The no-eviction rule is unit-tested in `chats.test.ts` (Knights' pool full, helpers still
  start, the Knight keeps its process).
- **D.** `routes.ts`, `mcpConfig.ts`, `jsonStore.ts`, `BuildingPage.tsx`, `highlight` and
  `plate` in the kit, and "Adding a utility" in `docs/BUILDING-PAGES.md`. Existing tests
  unchanged. The duplication is gone; the line count fell less than hoped, because the
  shared parts are documented and tested.
- **E.** A run log per utility (`runs.ts`), a "Cost and health" card on the Library and
  Forge pages, the guild's token total split by utility, and a toast when a run fails.

## Why now

We built four utilities quickly, each by copying the last. That was the right call to find
out what the guild should be. It is now the wrong base to build five more on (the Armorer,
Seer, Archmage, Enchanter and Lookout are planned). What we have, measured:

| Finding                                    | Evidence                                                                                                                                                                                                                         | Cost to you                                                                                                                                                                   |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Your decisions are in three places         | Skills to approve: the Skills tab (`skills.tsx`). Pieces to install: the Forge page (`forge.tsx`). Questions: the "needs you" beacon.                                                                                            | You go looking. Nothing tells you a skill or piece is waiting: notices only cover needs-you, arrived, left and finished (`notices.ts`).                                       |
| The utilities do not see each other's work | `installedSkills` reads `~/.claude/skills` and plugins only (`skills.ts`). A skill the Forge installs into a project's `.claude/skills` is invisible to it.                                                                      | "Your skills" misses forged skills; the Scout and the Reviewer compare against a partial list and can recommend a duplicate; the King cannot name a forged skill in an order. |
| Helper sessions crowd out Knights          | At most 6 `claude` processes run at once (`chats.ts`); librarian, smith and reviewer sessions keep theirs after their turn.                                                                                                      | A Library run plus a Forge order can evict a Knight you are working with.                                                                                                     |
| Never run on the real CLI                  | Every pipeline is tested on `web/e2e/fake-claude.mjs`. Tool allow-lists such as `Bash(git log:*)`, MCP configs and the prompts have never met the real `claude`.                                                                 | The first real run is the first test. The biggest risk we carry.                                                                                                              |
| Each utility copied the last               | 4 copies of the token-checking route wrapper (`*Routes.ts`), 4 MCP-config writers (`cli.ts`, `king.ts`, `library.ts`, `forge.ts`), 2 JSON stores (`archive.ts`, `forge.ts`), the same canvas helpers in 3 scenes, 3 page shells. | Every fix is made 3-4 times, and the next five utilities would make 9.                                                                                                        |

## Principles

- **No new features.** Every change makes something that exists faster to use, more
  reliable, or cheaper to extend.
- **Behaviour first, then structure.** Refactors change no behaviour, and the existing 208
  unit and 39 browser tests prove it, unchanged.
- **One step, one commit, one PR,** each green in CI, each with screenshots when visible.
- **Measured.** Each phase says how we will know it worked.

## The plan

### Phase A: a dress rehearsal on the real `claude` (first, because everything else assumes the pipelines work)

**What:** `npm run rehearse`, run by you, never by CI or tests. It runs each utility once,
for real, in a scratch folder inside your home, with a tiny budget: the King lists the
Knights; the Scout and Reviewer review one skill from a pinned public repository; a Knight
asks the Forge for a one-line slash command; the Blacksmith forges it; the Reviewer checks
it. It stops before anything is installed and writes a report of each step: passed, failed
(with the reason), and the tokens spent.

**How:** a script in `scripts/` that drives the real server through its own routes (as the
browser tests do, with the real CLI instead of the stand-in), and prints the report.

**Done when:** the report is green, and every failure it found is fixed with a test that
would have caught it.

### Phase B: one inbox for everything that waits on you

**What:** a **"Needs you"** tab beside Guild and Skills, with every decision in one list,
newest first: Knights asking a question, reviewed skills to approve, forged pieces to
install. Each row acts in place (Answer, Approve & install, Dismiss, Open). One badge counts
them all. A new decision raises a toast and the chime, and a desktop notification if you
turned those on, like a Knight's question does today.

**How:** a pure `decisions(state, skills, forge)` in `core` (unit-tested) that merges the
three sources; new notice kinds `skill-ready` and `piece-ready` in `notices.ts`; the tab
reuses the existing Skills and Forge actions. The Skills tab and the Forge page stay, for
browsing.

**Done when:** a browser test makes one of each decision and handles all three from the
inbox; nothing waits on you without a badge and a notice.

### Phase C: close the loops between the utilities

1. **The Library sees forged skills.** `installedSkills` also reads the `.claude/skills` of
   every project a Knight works in, as source "project: <folder>". "Your skills", the
   librarians' `list_installed_skills` and the King's `consult_archive` all include them.
2. **The Forge asks the Library first.** Before forging, the Blacksmith gets
   `list_installed_skills` and the Archive: when something that fits already exists, it
   says so instead of forging a duplicate, and the order shows "already in the Library:
   install that".
3. **Helpers do not take a Knight's place.** A librarian, smith or reviewer session closes
   its process when its turn ends; helpers get their own small pool (2) beside the
   Knights' 6, so a Library run never evicts a Knight.
4. **A message from a utility is not an order from the King.** The Forge telling a Knight
   its piece is ready arrives as a raven, not a walk to the Throne Room.

**Done when:** the cohesion test checks the forged skill appears in "Your skills" and in
the King's archive; a test runs a Library run, a Forge order and 6 Knights together with
no eviction.

### Phase D: one foundation for every utility (a refactor: no behaviour changes)

- `server/src/routes.ts`: one `guarded()` for every route file.
- `server/src/mcpConfig.ts`: one `writeMcpConfig(role, extraEnv)` for the King, the
  librarians, the smiths and the Knights.
- `server/src/jsonStore.ts`: one atomic, queued, 0600 JSON store behind the Archive and the
  Forge (and the next utilities).
- `web/src/scene.ts` gets `highlight` and `plate`; `web/src/BuildingPage.tsx` is the shell
  every building page fills (back button, ribbon title, scene, hint, cards).
- `docs/BUILDING-PAGES.md` becomes "add a utility": a role, its MCP tools, its store, its
  page, in that order, with the files to copy.

**Done when:** all tests pass unchanged, and the duplicated code above is gone (we expect
several hundred lines fewer).

### Phase E: show what each utility costs and how it is doing

**What:** each building page shows its helpers' usage (tokens this week, per run) and its
last run (when, how long, passed or failed); a failed run raises a notice, not only a note
in the Archive. The guild panel totals usage per utility next to the Knights'.

**How:** helper sessions are already marked (librarian, smith); the tokens are already
counted per hero (`partyTokens`). This sums them by role and keeps a small run log per
utility.

**Done when:** after a rehearsal, every page shows its cost, and a broken run is
impossible to miss.

## Order, size and why this order

| Phase              | Size | Why here                                                             |
| ------------------ | ---- | -------------------------------------------------------------------- |
| A. Dress rehearsal | S    | The biggest risk is unknown; find out before polishing.              |
| B. One inbox       | M    | The biggest daily win for you.                                       |
| C. Close the loops | M    | Makes the utilities one system; B shows the result.                  |
| D. One foundation  | M    | Before the Armorer and the Seer, so they are built once, not copied. |
| E. Cost and health | S    | Trust: you can see what each helper spends and whether it works.     |

## After this

1. **The Armorer** and **the Seer**, on the new foundation: a role, tools, a store and a
   page each, from the "add a utility" guide, without copying.
2. **The Archmage, the Enchanter and the Lookout**, the same way.
3. **Portals on macOS**, checked on a real Mac (only the parser is tested today).
4. **GitHub access for the session**, so branches and pull requests go up without the
   bundle.
