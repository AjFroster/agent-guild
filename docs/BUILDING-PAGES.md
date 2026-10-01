# Adding a utility

A utility is a building whose helpers do work for the Knights: the Library's librarians,
the Forge's smiths, the Tower's wizards. Each is built the same way, in this order, from
shared parts. Copy the Forge (`forge.ts`, `forgeRoutes.ts`, `forge.tsx`, `forgeScene.ts`)
as the worked example.

## 1. A role and its MCP tools (server)

- **The helper's session.** Start it with `chats.start({ …, helper: true })`: helpers run
  in their own pool beside the Knights' and close their process when their turn ends, so
  they never take a Knight's place. Give it the narrowest `allowedTools` that does the job
  (the Blacksmith reads; it never writes).
- **Its MCP config.** `writeMcpConfig(file, { guildUrl, token, role })` from
  `server/src/mcpConfig.ts`. The role chooses its tools in `kingMcp.ts` (`GUILD_ROLE`): add
  a `<ROLE>_TOOLS` list there, one tool per route, and add the role to the preflight in
  `scripts/rehearse.ts`.
- **Mark it on the map.** Publish an event for its session (like `librarian` or `smith` in
  `core/src/events.ts`) so the map and the notices know it is a helper, not a Knight.
- **Telling a Knight something** goes as a raven: call the routes' `onRaven(knightId)`
  before `chats.send`, so the Knight reads it where it stands instead of walking to the
  Throne Room.

## 2. Its store (server)

Keep what the utility owns in one `JsonStore` (`server/src/jsonStore.ts`): queued,
atomic, readable by the user only. Give it a `shape` that turns whatever is on disk into
valid data.

## 3. Its routes (server)

`<utility>Routes.ts`, every route wrapped in `guard(opts.isToken)` from
`server/src/routes.ts`. Announce changes (`announce('<utility>', { waiting })`) so the
page and the inbox update. Anything that waits on the user belongs in the **Needs you**
inbox: add it to `decisions()` in `web/src/decisions.ts` and a notice kind in
`web/src/notices.ts`. Nothing reaches the user's files without their click.

## 4. Its page (web)

Each building's page is a Tiny Swords scene of the building and its helpers, with cards
below it.

1. **Art.** Use Tiny Swords first (`web/public/assets/tiny-swords/`; the full free pack is
   in Agent Quest's repository, see `CREDITS.md`). Copy what you need unmodified, add it
   to `ART` in `web/src/scene.ts`, and note it in `CREDITS.md`.
2. **Props the pack lacks** (furniture, tools, glowing things): draw them in
   `scripts/art/props.py` with its helpers (`outlined` gives the pack's 3px navy outline;
   the palette constants are sampled from the pack), then run
   `pip install -r scripts/art/requirements.txt && python3 scripts/art/props.py`. CI checks
   the committed PNGs match the script. Animated props are horizontal strips; add their
   frame count to `FRAMES` in `scene.ts`.
3. **The scene module** (`web/src/<building>Scene.ts`): a pure model built from the guild
   state (what to show), a pure pick function (what a click lands on), and a draw
   function using the kit in `scene.ts`: `grass`, `terrain`, `put` (anchored at the feet,
   drawn back to front), `nine` for carved boards and parchment, `ribbon` for name tags,
   `plate` for small labels, `highlight` for what the pointer is over, and the village's
   `bubble` for "!", "zzz" and work. Unit-test the model and pick function.
4. **The page**: `<BuildingPage>` (`web/src/BuildingPage.tsx`) gives the way back, the
   ribbon title, the scene and the hint; put the details in `.ts-card` parchment cards
   with `.ts-ribbon` headings and `.ts-button` buttons as its children.
5. **Navigation**: open the page from the building on the map (`select` in `App.tsx`,
   `usePage` in `selection.ts`), and add a demo fixture and a `capture` in
   `web/e2e/guild.spec.ts` so CI posts a screenshot.

## 5. Tests

Unit-test the store, the routes' rules and the scene's model and pick. In the browser
tests, `web/e2e/fake-claude.mjs` plays the helper over the real MCP server (it picks its
part from the prompt and `GUILD_ROLE`): never the real `claude`. Then run
`npm run rehearse -- --live` yourself once, to see the helper work on the real CLI.
