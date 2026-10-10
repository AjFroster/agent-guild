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
| **Battle report** | A scheduled report per war: battles won, fighting, stalled; what it cost | Saved, toasted, and read in the War Camp         |

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
- **The chronicler's account (optional, uses usage; not built yet).** When turned on, a helper session (the
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

## On the map and the War Camp

- **On the map**: a war camp on the Barracks fence plants one banner per war (up to four,
  then "+N") with its tally of won battles; a banner waves while one of its Knights fights.
  A Knight wears its war's banner colour, which no other Knight then takes, and its panel
  names the war and its victories. Clicking the camp (or its "⚔ War Camp" sign, or the
  War Camp button in the top bar) opens the War Camp. (The server side is still called
  the War Room in the code: `server/src/wars.ts`, `warRoutes.ts`.)
- **The War Camp** (`?page=wars`, `web/src/wars.tsx` and `campScene.ts`): a Tiny Swords
  scene of the camp. Behind a palisade stands a tent per war in its banner's colour
  (active wars first, sleeping ones faded; three at most, or two and "+N"), its victories
  on a banner at the gate. On the sand in front, the Knights of every open war duel
  goblins (up to four, working Knights first), and the goblins' own camp stands across the
  field. Clicking a tent opens that war; clicking a Knight opens its chat. In demo mode
  there are no wars, so the camp drills the demo's Knights. Below the scene: every war,
  grouped as active (a Knight fighting now), sleeping (nobody at work) or ended; declaring
  a war; and the battle reports with their settings. Built on `BuildingPage.tsx` and the
  scene kit like every other page (`docs/BUILDING-PAGES.md`).
- **The duels** (`web/src/duel.ts`): each Knight swings at a goblin from the Tiny Swords
  pack (Torch, TNT or Barrel goblin, in red, blue, purple or yellow) with a bug's name
  ("Merge Conflict", "Flaky Test"). The goblin is random but seeded by the Knight's
  session, so it is the same foe on every visit, and no two on one field share a name. A
  Knight at work plays its attack row and its goblin fights back; on each hit the goblin is
  knocked back a step and sparks fly, as at the training dummies. The goblin's health bar
  is the Knight's quests still to do ("quests 2/5"); a resting Knight shows "z z" and its
  goblin "resting", and one waiting on you a red "!".
- **A war's battlefield** (`?page=wars&war=<id>`, `web/src/fieldScene.ts`): the same duels
  for one war's Knights (six at most), then the war's card: goal, victories, tokens and
  loose ends, battles as rows (kind, branch, state, Knights, pull request and checks) with
  their actions (send a Knight, withdraw an aim, say how a battle ended, clear the field,
  and why the guild kept a worktree).
- **Needs you** gains stalled battles and battles whose branch is gone with no word on how
  they ended ("It was won" / "Retreated" right there).

## Status

Built (2026-10-09), all but the chronicler's account:

- `core/src/wars.ts`: branches to battles, kinds, states, victories, the clearing guards
  and the dispatch, pure and unit-tested; a `victory` event gives each Knight who fought a
  merged battle 100 XP.
- `server/src/wars.ts` (the War Room: its record, the git and `gh` reads, worktrees, the
  guards, the report scheduler) and `warRoutes.ts`; `list_wars`, `declare_battle` and
  `send_knight` in `kingMcp.ts`. Tested on real git repositories with a fake `gh`.
- The map, the War Camp page and Needs you, with unit tests for the camp, the duels and the banners.
- `web/e2e/wars.spec.ts` runs a whole campaign on the live server (real git,
  `e2e/fake-gh.mjs`, `e2e/fake-claude.mjs`): declare, plan, send a Knight into its
  worktree, win by a merged pull request, refuse then clear the field, answer a vanished
  branch in Needs you, and write a report. CI posts its screenshots.

`AGENT_GUILD_GH` names the `gh` to use (`0` turns pull requests off); the War Room looks
every `AGENT_GUILD_WAR_POLL_MS` (one minute), and asks `gh` at most every two minutes.

## Decided

- **One war per repository** (2026-10-09). A war is one repository folder; a war spanning
  several repositories is out of scope for now.
- **Won battles' worktrees clear themselves, with guards** (2026-10-09): only after the PR
  is merged, and only when nothing would be lost (see "Clearing the field").
