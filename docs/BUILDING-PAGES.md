# Building pages

Each building can have a page of its own: a Tiny Swords scene of the building and the
heroes who work there, with cards below it. The Library is the first
(`web/src/library.tsx`, `web/src/libraryScene.ts`). To add another:

1. **Art.** Use Tiny Swords first (`web/public/assets/tiny-swords/`; the full free pack is
   in Agent Quest's repository, see `CREDITS.md`). Copy what you need unmodified, add it
   to `ART` in `web/src/scene.ts`, and note it in `CREDITS.md`.
2. **Props the pack lacks** (furniture, tools, glowing things): draw them in
   `scripts/art/props.py` with its helpers (`outlined` gives the pack's 3px navy outline;
   the palette constants are sampled from the pack), then run
   `pip install pillow && python3 scripts/art/props.py`. Animated props are horizontal
   strips; add their frame count to `FRAMES` in `scene.ts`.
3. **The scene module** (`web/src/<building>Scene.ts`): a pure model built from the guild
   state (what to show), a pure pick function (what a click lands on), and a draw
   function using the kit: `grass`, `terrain`, `put` (anchored at the feet, drawn back to
   front), `nine` for carved boards and parchment, `ribbon` for name tags, and the
   village's `bubble` for "!", "zzz" and work. Unit-test the model and pick function.
4. **The page**: draw the scene with `<SceneCanvas>`, and put details in `.ts-card`
   parchment cards with `.ts-ribbon` headings and `.ts-button` buttons.
5. **Navigation**: open the page from the building on the map (`select` in `App.tsx`,
   `usePage` in `selection.ts`), and add a demo fixture and a `capture` in
   `web/e2e/guild.spec.ts` so CI posts a screenshot.
