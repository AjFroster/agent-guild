# Wars and Battles

The guild shows sessions, but not the projects they serve. The King can already command
Knights in any folder, yet nothing tells him (or you) which projects exist, what each is
fighting for, or how it is going. Wars and Battles add that layer.

| Kingdom           | Means                                                                    | Ends                                             |
| ----------------- | ------------------------------------------------------------------------ | ------------------------------------------------ |
| **War**           | A project: one repository folder, with a name, a goal and a banner       | Never on its own; you can end it (archived)      |
| **Battle**        | One branch of work in that war: a feature, a refactor, a fix             | **Won** when it merges, **retreated** if dropped |
| **Knight**        | A session fighting a battle (unchanged: one Claude Code session)         | When the session ends                            |
| **Quest**         | A todo item inside a Knight's turn (unchanged)                           | When ticked                                      |
| **Battle report** | A scheduled report per war: battles won, fighting, stalled; what it cost | Saved, toasted, and read in the War Room         |

## What a war is

A war is a folder you (or the King, with your yes) declare: `~/code/agent-guild` becomes
"The War for the Guild". It keeps:

- a **name** and a **goal** in a sentence or two ("Ship the Armorer and the Seer"),
- a **banner**: one of the team colours (`TEAMS` in `web/src/village.ts`). Every Knight
  fighting in that war wears it, so the map reads by project at a glance. Knights outside
  any war keep today's colour from their id; the King keeps gold, librarians purple and
  smiths red.
- optional **war aims**: a short backlog of battles not yet started (title and kind).

Wars live in `~/.agent-guild/wars.json` through `jsonStore.ts` (queued, atomic, 0600),
like the Archive and the Forge. The guild suggests a war for any folder a Knight has worked
in that is not one yet ("3 Knights have fought in `api-server`: declare a war?"); it
never creates one on its own.

## What a battle is

A battle is a branch in the war's repository, found by the guild and optionally declared
ahead of time:

- **Found**: every poll (the same read-only, once-a-minute pass as `server/src/git.ts`) lists
  the war's local branches other than the default one, with ahead and behind counts and the
  time of the last commit. A branch the guild has not seen becomes a battle. Its **kind**
  comes from the prefix the repo already uses: `feat/` a feature, `fix/` a fix, `refactor/`
  and `chore/` a refactor, anything else plain.
- **Declared**: a war aim the King or you start ("Battle for the activity feed",
  `feat/activity-feed`). Declaring writes nothing to the repository until a Knight is sent
  to fight it.
- **Fighting**: a Knight's session runs on that branch (its folder's current branch, or
  its worktree's, see below). The battle shows its Knights, their quests and tokens.
- **Stalled**: nobody has committed or worked on it for 2 days (a setting). Stalled battles
  lead the report.
- **Won**: its PR is merged (read through `gh`). Without `gh`, the guild falls back to
  `git branch --merged`, which misses squash merges (this repo squashes every PR): there a
  merged battle would look abandoned, so the War Room asks you instead of guessing. Victories add to the war's tally and give the Knights
  who fought it a bonus (100 XP, beside today's 50 a quest and 10 a turn).
- **Retreated**: the branch was deleted unmerged, or you marked it so.

**Privacy.** Today only counts leave `git.ts`. Battles add branch names, which a hero's
panel already shows, and nothing more: no file names, no commit messages, no diffs reach
the page. PR and CI states come from your own `gh`, read-only, and only as states
(open, merged, checks passing or failing).

## One Knight per battle: worktrees

Today the King gives an order to "the Knight already working in that folder", so one
repository holds one Knight. Battles fix that. When the King (or you) sends a Knight to a
battle, the guild runs `git worktree add` for that branch under
`~/.agent-guild/worktrees/<war>/<branch>` and starts the Knight there. Two battles in the
same war can then run at once without fighting over one checkout.

**Clearing the field.** Once a battle is won, the guild removes its worktree on its own,
but only when every guard holds (checked on each poll, all read-only until the last step):

1. **The PR is merged**, read through `gh`. Without `gh` nothing is cleared automatically
   (a squash merge cannot be told from an abandoned branch with git alone).
2. **A day has passed** since the merge, so a follow-up fix can still use the folder.
3. **No Knight is in it**: no running session there, and no transcript written from it
   in that day.
4. **No loose ends**: no uncommitted or untracked files, and the worktree's last commit is
   the PR's head commit (from `gh`), so every commit in it went into the merge. (Plain "on a
   remote" would not do: GitHub often deletes a merged PR's branch.)
5. **Nothing ignored but rebuildable output**: `git status --ignored` shows only
   `node_modules`, `dist`, `build`, `coverage`, `test-results`, `playwright-report` and
   similar. A `.env` or any other ignored file keeps the worktree.

Then it runs `git worktree remove` without `--force` (git refuses on its own if anything
changed in between), keeps the branch, notes it in the next battle report and raises a
toast. A worktree that fails a guard stays, with a "Clear the field" button that names the
guard. Automatic clearing is a setting, on by default; you can turn it off.

Adding a worktree for a battle you or the King ordered, and removing one these guards
cleared, are the only writes the guild makes to a repository.

## Battle reports

Like the Town Crier (`server/src/crier.ts`), a scheduler inside the server: off until you
turn it on, a time of day, run once if the time passed while the guild was down.

- **The dispatch (free).** Built by the guild from its own state and git, no usage: per
  war, battles won since the last report, battles fighting (with their Knights), stalled
  battles, loose ends (unpushed commits, uncommitted files), and tokens spent by its
  Knights. Saved in `~/.agent-guild/battle-reports/`, raised as a toast, and readable in the
  War Room.
- **The herald's account (optional, uses usage).** When turned on, a helper session (the
  helper pool, closed after its turn) reads the dispatch and the war's goal and writes a
  short account: what moved, what is at risk, what to do next. Like every helper, it reads
  and writes words only.
- The King reads the latest dispatch on `list_wars`, so "how are my wars going?" costs one
  answer, not a survey of every Knight.

## The King

New tools in `kingMcp.ts`, each behind a route in a new `warRoutes.ts`:

- `list_wars`: each war with its goal, its battles and their state, and the last dispatch.
- `declare_battle(war, title, kind)`: adds a war aim.
- `send_knight(war, battle, order, mode)`: worktree plus a new Knight on that branch (the
  `raise_knight` rules hold: your yes for a folder you have not named).
- `declare_war` is not a King tool: wars are yours to declare, from the War Room or by
  accepting the guild's suggestion.

His prompt gains one line: plan by war, and give each order a battle.

## On the map and the War Room

- **On the map**: each war plants its banner by the Barracks with its tally of won
  battles; a Knight's banner colour is its war's. A stalled battle puts a red flag over its
  Knight's bedroll.
- **The War Room** (`?page=wars`, opened by clicking a war tent beside the Barracks, a new
  prop drawn by `scripts/art/props.py`): a Tiny Swords scene of a war table with one banner
  per war (`ui/Banner_Vertical.png`), then
  parchment cards per war: goal, battles as rows (kind, branch, state, Knights, tokens), war
  aims, and the latest dispatch. Built on `BuildingPage.tsx` and the scene kit like every
  other page (`docs/BUILDING-PAGES.md`).
- **Needs you** gains "a battle has stalled" and "a war has no Knight and open aims".

## Phases

1. **Wars and battles, read-only**: `core/src/wars.ts` (pure: branch list to battles,
   kinds, states, the dispatch; unit-tested), `server/src/wars.ts` on `jsonStore.ts`, the
   branch scan beside `git.ts`, banner colours by war, the War Room page with a fixture
   and a CI screenshot. No usage, no writes to any repository.
2. **Battle reports**: the scheduler and the free dispatch, toasts, the report list.
3. **The King's war council**: `list_wars`, `declare_battle`, `send_knight` with
   worktrees, and the browser test of a King sending two Knights into one war.
4. **PRs and CI through `gh`** (shared with the Lookout, docs/TOWER.md) and the herald's
   account.

## Decided

- **One war per repository** (2026-10-09). A war is one repository folder; a war spanning
  several repositories is out of scope for now.
- **Won battles' worktrees clear themselves, with guards** (2026-10-09): only after the PR
  is merged, and only when nothing would be lost (see "Clearing the field").
