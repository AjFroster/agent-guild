# The Forge

Knights fight the development; the Forge's smiths make and mend their equipment. Two
smiths, each its own Claude Code session with its own MCP tools (like the librarians):

- **The Blacksmith (the Smithy)** forges equipment for one project: a skill ("how we
  release this app"), a slash command, a hook, or a better `CLAUDE.md`. It first asks the
  Library: when a skill the user has (their own, a plugin's, or a project's) or one in the
  Archive already does the job, it says so and forges nothing. Otherwise it reads that
  project's code and history, drafts the piece, and hangs it on the weapon rack. The
  Library's Reviewer checks it like any skill, and nothing reaches the project until the
  user approves.
- **The Armorer (the Repair Bench)** takes broken weapons off the Knights: a failing build
  or test, a branch that no longer merges, loose ends left behind. It works in its own git
  worktree on its own branch, never pushes, and reports what it changed for the user to
  take or leave.

Each kind of equipment is a weapon on the rack: a **sword** is a skill, an **axe** a slash
command, a **spear** a hook, a **shield** a `CLAUDE.md`. A broken weapon on the bench is a
repair job.

## Rules

- The smiths never push, never install, and never touch `~/.claude`. Approving a piece is
  the user's click, and installs exactly what was reviewed into the project's `.claude/`.
- A hook is shown as a proposal (the settings change it would make); the user applies it.
- The Armorer works only in a worktree under the guild's data folder, on a branch named
  `forge/repair-…`, in a permission mode the user chose.
- What the guild learns from transcripts stays as it is (tool names, todos, turn ends,
  token counts). The smiths read the project itself, not other sessions' conversations.

## Status

Done: phases 1 and 2, the King's `commission_equipment`, the Forge's signs on the map, and
the cohesion test in `web/e2e/chat.spec.ts`: a Knight asks, the Blacksmith forges in its
project, the Library reviews, the user installs, the Knight is told. Next: the Armorer.

## Phases

1. **Art and scene** (this branch, first): Forge props in the Tiny Swords style
   (`scripts/art/props.py`), a mock-up of the Forge's grounds, then the Forge page on the
   scene kit (`docs/BUILDING-PAGES.md`) with a demo fixture and screenshots in CI.
2. **The Smithy**: the forge orders queue (`server/src/forge.ts`, like `archive.ts`), the
   Blacksmith role and its MCP tools, review by the Reviewer, approve-and-install into the
   project, and the Forge page's rack and anvil driven by the queue.
3. **The Repair Bench**: repair jobs from loose ends and from the user ("mend this
   branch"), the Armorer role in a worktree, its report and diff summary, and the bench in
   the scene.
4. **The kingdom**: signs over the Forge on the map (like the Library's), and King tools to
   commission a piece or a repair for a Knight.
