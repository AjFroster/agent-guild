# Merging the guild's branches

Seven branches wait to land on `main`, 31 commits in all. They are **stacked**: each starts
where the one before it ends, so they must land in order. This page is the plan: the
order, how to keep each pull request small to review although `main` squash-merges, what
to check before each merge, and what to do after the last one.

## The stack

| #   | Branch                            | PR title (Conventional Commits)                                  | Size            | Look at (CI screenshots)                                        |
| --- | --------------------------------- | ---------------------------------------------------------------- | --------------- | --------------------------------------------------------------- |
| 1   | `feat/report-card-and-loose-ends` | feat: a report card and loose ends for every Knight              | 33 files, +1.2k | 12-report-card, 13-loose-ends                                   |
| 2   | `feat/agentic-kingdom`            | feat: the kingdom: a King, Knights, Barracks and the Throne Room | 34 files, +3.3k | 14-kingdom, 15-king-chat, 16-king-map, 17/18 talk               |
| 3   | `feat/skills-library`             | feat: the Library, its librarians, and the Library page          | 76 files, +4.4k | 15-library-signs, 19 to 22                                      |
| 4   | `feat/forge`                      | feat: the Forge, where the Blacksmith forges what a Knight needs | 50 files, +2.9k | 17-forge-signs, 18-forge-page, 23 to 25                         |
| 5   | `feat/tower`                      | feat: the Tower's Portal Keeper                                  | 43 files, +1.8k | 26-portal-on-the-map, 27-tower-portals                          |
| 6   | `chore/ci-art-check`              | chore(ci): check the drawn props are up to date                  | 3 files         | (none: the Checks job gains an Art step)                        |
| 7   | `refactor/sharpen-workflows`      | refactor: sharpen the guild's workflows (docs/SHARPEN.md)        | 62 files, +2.5k | 28-needs-you-inbox, 29-forge-health, 17-forge-signs (the raven) |

Why this order: each branch builds on the previous one's code (the Library needs the
King's MCP server, the Forge needs the Library's Reviewer, the Tower needs the scene kit),
and the files every branch touches (`core/src/events.ts`, `server/src/cli.ts`,
`server/src/chats.ts`, `web/src/village.ts`, `web/e2e/interact.spec.ts`) only merge cleanly
in the order they were written. Never reorder or merge two out of turn.

The local `main` already holds branches 1 to 6 (fast-forwarded to run the guild). It is
not pushed and must not be: `main` is protected, and everything lands through PRs.

## Opening the pull requests: stacked

Open all seven at once, each **based on the branch before it** (PR 1 on `main`, PR 2 on
`feat/report-card-and-loose-ends`, …). Then every PR shows only its own commits, and each
can be reviewed while the earlier ones wait. Mark PRs 2 to 7 as drafts until the one
below them merges, so nothing lands early.

## Merging one: the loop

For each PR, in order:

1. **Before merging**, on the PR:
   - CI is green: Checks (types, lint, format, unit tests, shellcheck, Art), Build, Browser.
   - The screenshots in the table above look right (the Browser job posts them).
   - Its base is `main` (the previous PR merged).
2. **Squash-merge** it with the title from the table, and delete its branch.
3. **Move the next PR onto `main`.** A squash merge puts the earlier branch's work on
   `main` as one new commit, so the next branch still carries the old commits underneath.
   Replay only its own commits onto the new `main`:

       git fetch origin
       git rebase --onto origin/main <merged-branch> <next-branch>
       git push --force-with-lease origin <next-branch>

   (These are our own branches, so rewriting them is fine.) GitHub retargets the next PR
   to `main` when the merged branch is deleted; check its base says `main`, then take it
   out of draft. CI runs again on the rebased branch: that run is the one that counts.

4. Repeat.

**Rehearsed:** this whole loop was simulated in a scratch clone (squash each branch onto
upstream `main` da6f80e, then `rebase --onto` the next): all seven steps replay with no
conflicts, and the final `main` is identical, file for file, to `refactor/sharpen-workflows`.
If `main` moves before you start, a conflict becomes possible. It will almost always be in
one of the shared files above: keep both sides (each branch only adds), run
`npm test && npm run typecheck`, and continue.

**The fast alternative:** one PR from `refactor/sharpen-workflows` to `main`, squashed
into a single commit. One review instead of seven, but a 300-file diff and one commit to
revert if anything goes wrong. Use it only if reviewing each step is not worth the time.

## After the last merge

1. Update the local `main`: `git checkout main && git fetch && git reset --hard origin/main`
   (it held the pre-squash commits; the squashed ones replace them).
2. `npm ci && npm test && npm run e2e`: everything green on `main` itself.
3. `npm run rehearse`: the free preflight against your `claude`.
4. `npm run rehearse -- --live` **once**: the first real run of the Forge, the King and the
   librarians. It uses your Claude usage (a few small turns). Fix anything it finds with a
   test that would have caught it, on a `fix/` branch.
5. `npm start` and use it for a day: the Needs-you tab, a Forge order from a Knight, the
   Tower's portals.

## If something breaks after merging

Each PR is one squashed commit on `main`, so `git revert <commit>` on a `fix/` branch
undoes exactly one step. Revert from the top of the stack down: a later step depends on
the earlier ones, never the other way round.

## Before opening any PR

- Fixtures and test transcripts hold fictional names and paths only (checked: no real
  usernames, home folders or e-mail addresses in `fixtures/`, `web/e2e/`, `docs/`,
  `scripts/`).
- No branch runs the real `claude` in tests; `npm run rehearse -- --live` is never in CI.
