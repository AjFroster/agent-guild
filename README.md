# agent-guild

Your Claude Code sessions as an RPG guild. Sessions are heroes, sub-agents are party
members, and todos are quests that earn XP. A beacon lights up when an agent is waiting
on you.

Local-first. Watching is read-only: the guild follows the transcripts Claude Code
already writes to `~/.claude/projects/` and never changes your Claude settings, and the
map only receives tool names, todo titles, turn ends and token counts. The server also runs
read-only `git status` in the folders sessions ran in, and sends on two counts: commits on
no remote, and uncommitted files.

Chatting is not read-only. **New session** and **Open chat** run your own `claude` CLI
in headless mode (`claude -p`, streaming JSON), with your login and settings, in a folder
you choose inside your home directory. Conversation text then reaches the page, over
127.0.0.1 only and only with the link's token. Set `AGENT_GUILD_NO_CONTROL=1` to turn
chats and the Town Crier off and keep the guild watch-only. Skipping permission checks is
never offered unless you start the guild with `AGENT_GUILD_ALLOW_BYPASS=1`.

## Run it

```bash
npm ci
npm start
```

Open the link it prints (`http://127.0.0.1:4747/?token=…`). The server only listens on
127.0.0.1 and refuses requests from any other origin, other apps on localhost included.

The token is kept in `~/.agent-guild/token` (readable only by you), so the link stays the
same across restarts; delete that file and restart to invalidate old links. The page keeps
the token in the browser and takes it out of the address bar, so after the first visit
`http://127.0.0.1:4747/` opens the guild on its own.

| Variable                    | Default              |                                                                |
| --------------------------- | -------------------- | -------------------------------------------------------------- |
| `AGENT_GUILD_PORT`          | `4747`               |                                                                |
| `AGENT_GUILD_MAX_AGE_HOURS` | `3`                  | sessions older than this are not loaded at startup (`0` = all) |
| `AGENT_GUILD_IDLE_MINUTES`  | `20`                 | a silent session leaves the guild after this (`0` = never)     |
| `CLAUDE_PROJECTS_DIR`       | `~/.claude/projects` |                                                                |
| `AGENT_GUILD_ALLOW_BYPASS`  | off                  | `1` offers "skip all permission checks" for new chats          |
| `AGENT_GUILD_NO_CONTROL`    | off                  | `1` turns chats and the Town Crier off: watch-only             |
| `AGENT_GUILD_GIT`           | on                   | `0` stops checking session folders for unpushed work           |
| `CLAUDE_SKILLS_DIR`         | `~/.claude/skills`   | installed skills; approved skills are installed here           |
| `AGENT_GUILD_PORTALS`       | on                   | `0` stops looking for services on local ports                  |

### Keep it running (Windows + WSL)

```bash
scripts/autostart-wsl.sh install   # systemd user service on port 4760 + a Windows Startup keep-alive
scripts/autostart-wsl.sh link      # print the link again
scripts/autostart-wsl.sh uninstall
```

The guild then starts at Windows sign-in and keeps running with no terminal open, which
is what lets the Town Crier fire at its scheduled time. The token lives in
`~/.agent-guild/token` (readable only by you), so the link stays the same; delete that
file and restart to invalidate old links.

Recorded demos need no server: `npm run dev`, then `http://127.0.0.1:5280/?demo=party`.

## The Herald: the guild inside each session

The Herald (`mod/`) is a Claude Code mod that brings the guild into every session:

- it tells the guild the moment a session waits on a **permission prompt**, which the
  transcripts cannot show, and when that wait ends;
- it shows the session's hero on the **status line**: `⚔ Knight · Lv 3 · 320 XP`;
- it raises a **toast** when the hero levels up;
- **`/guild`** says whether the guild is up and puts the village link on your clipboard.

Install it from a Claude Code terminal session:

```text
/plugin install agent-kingdom --marketplace AjFroster/agent-guild
```

Answer `y` to add the marketplace, then pick a scope. Its two settings (in `/config`) are
the guild's address (default `http://127.0.0.1:4747`) and the token file (default
`~/.agent-guild/token`). It sends the guild a session id and a kind (`permission` or
`cleared`), nothing else; it only talks to 127.0.0.1, localhost or ::1; the token goes
only into the `Authorization` header and, on `/guild`, your clipboard; and it never
blocks, delays or changes anything in the session. When the guild is not running it
stays quiet. Its rules and checks: [docs/MOD.md](docs/MOD.md).

## How it maps

| Claude Code                                             | Guild                                  |
| ------------------------------------------------------- | -------------------------------------- |
| Session                                                 | Knight, named after its project folder |
| The session you crown                                   | King, who commands the Knights         |
| Sub-agent that edits or runs commands                   | Footsoldier, following its Knight      |
| Sub-agent that only reads and searches                  | Worker, following its leader           |
| Read/Grep/Glob · Edit/Write · Bash · WebFetch/WebSearch | Library · Forge · Arena · Tower        |
| Asking the Forge for equipment                          | Walks to the Forge                     |
| TodoWrite items                                         | Quests; each finished quest is 50 XP   |
| Finished turn                                           | 10 XP, back to the Guildhall           |
| AskUserQuestion                                         | Red "!" bubble and "needs you" beacon  |
| Finished its turn, resting                              | Asleep on a bedroll in the Barracks    |
| Given a message, by you or the King                     | Stands before the throne, then works   |
| Working                                                 | Swings at a training dummy             |

## Using it

- **New session** starts Claude Code in a folder you pick, with a permission mode
  (edit files freely, plan only, auto, or ask; "skip checks" only with
  `AGENT_GUILD_ALLOW_BYPASS=1`). Talk to it in the chat drawer: replies stream in, tool
  calls show as rows you can expand, **Stop** ends the current turn.
- **Talk to the King** crowns a King on your first message: one Claude Code session that
  works for you by commanding the others. It sees every Knight (session) and what it is
  doing, gives orders to the Knight already working in a folder, raises a new Knight when
  none covers the work, and reports back. It cannot edit files or run commands itself,
  only read; each Knight works under its own permission mode. The guild refuses to let it
  interrupt a Knight mid-turn, talk over a session that is open in a terminal, or skip
  permission checks. Gold lines on the map show which Knights serve the King.
- **Open chat** on a session's panel shows its conversation, including sessions you
  started in a terminal, and lets you continue it (`claude --resume`).
- **Town Crier** (off until you turn it on, since each run uses your Claude usage)
  writes a daily report on tech and AI at 18:00, keeping stories Claude
  scores at or above the cutoff (default 7/10). Change the time and cutoff, run it now,
  and read past reports in the guild panel. It runs while the guild is running; if 18:00
  passed while it was off, it runs once at the next start that day. Reports are saved in
  `~/.agent-guild/town-crier/`.
- The `claude` CLI must be logged in on this machine once (`claude`, then `/login`). If
  it is not, the chat says so instead of failing silently.

- **Click a hero** to see that session: what it is doing now, its project branch and
  model, party members, quests, which buildings it spends its time in, and its latest tool
  calls. Its **report card** sums it up: time on task, turns, tool calls, quests done,
  and tokens used (in, out, cache read and write, and with its party for a leader). The
  guild panel shows the total across every session.
- **Loose ends** in the guild panel lists sessions whose folder has commits on no remote
  or uncommitted files, including sessions that have left the guild. A hero with loose
  ends says so in the roster and on its panel. Folders are checked once a minute.
- **The Library and the Skills tab.** Two librarians keep an Archive of skills. Once a day
  (when you turn them on in the Skills tab; they start off, since each run uses your
  Claude usage) the **Scout** searches GitHub for new skills from repositories with at
  least 5,000 stars (change the threshold in the Skills tab; the Archive refuses anything
  below it) and pins each to a commit, and the **Reviewer** reads every file of each one at that commit, compares it
  with the skills you have, and gives a verdict: fills a gap, better than what you have,
  duplicate, or risky (with the risks it found). They treat everything in a repository as
  untrusted and can install nothing. You decide in the **Skills** tab beside the Guild:
  **Approve & install** copies exactly the reviewed commit of that skill's folder into
  `~/.claude/skills` (never over an existing skill, never a symbolic link), where every
  Knight can use it. The King checks the Archive when he plans orders.
- **The Library page.** The librarians work inside the Library, so the map shows them as
  signs over its roof: an open book while one works, "zzz" while it rests, a red "!" when
  it needs you, and a gold count on the door of skills waiting for your review. Click the
  Library to open its page, a pixel-art scene of its grounds: the Scout at a crystal orb
  that glows while it searches, the Reviewer at a lectern whose pages turn while it reads,
  a campfire lit while either works, the Archive board with a note for each skill waiting
  for you, and a sack of gold for each skill installed. Click a librarian to open its chat,
  or the board to review skills. Below it: **Your skills**, every skill you have, sortable
  by GitHub stars or name (stars are known for skills installed from the Archive; your own
  and plugins' skills sort last), then each librarian's desk, their schedule and threshold,
  Run now, the Archive's counts and their notes.
- **The Forge.** Knights started from the guild can ask the Forge for equipment their
  project is missing (a skill, or a slash command); the King and you can commission it too,
  from the Forge page. The **Blacksmith** reads that project (it can change nothing) and
  forges the piece; the Library's **Reviewer** tests it; you approve it on the Forge page,
  and only then is exactly the reviewed piece written into the project's `.claude/` (never
  over anything). The Knight who asked is told where it is. On the Forge page the
  Blacksmith hammers at the anvil while it works, and each piece waiting for you hangs on
  the rack: a sword for a skill, an axe for a command. The Armorer, who will mend broken
  builds, comes next.
- **The Tower and its portals.** The Portal Keeper finds every service your own programs
  are listening on (a dev server, an API, a database) and stands a portal for each on the
  Tower page: purple if it runs in a Knight's project, green if it is a website (with its
  page title), a plain stone arch if it is not. Click a portal to open it. Rename, pin or
  hide them; a Knight whose dev server is up gets a portal button beside it on the map, and
  the Tower's door counts them. It costs no usage: the guild looks itself (and checks each
  new port once with one request to 127.0.0.1, which you can turn off). The Tower's other
  wizards (Seer, Archmage, Enchanter, Lookout) come next.
- **Wars and battles.** Declare a war on a repository in the **War Camp** (the ⚔ button,
  or the war camp on the Barracks fence) and every branch in it becomes a battle: planned,
  fighting, holding, stalled, won or retreated. Send a Knight into a battle and it works in
  its own git worktree; the King can too, with `list_wars`, `declare_battle` and
  `send_knight`. A battle is won when its pull request merges (read with `gh`, states and
  checks only), and every Knight who fought it gets the victory. A won battle's worktree is
  cleared a day after the merge, and only when nothing in it would be lost. Stalled
  battles, and branches that vanished without a word, wait in Needs you. Battle reports
  sum up each war, on demand or daily, at no usage. See `docs/WARS.md`.
- **What a Knight is working on** (its quest in progress) shows under its name on the map
  and in its panel. A **Talk** button sits beside the Knight you select, and beside any
  Knight waiting on you (in red): one tap opens its chat.
- **Click a building** to see who is there now, which tools send heroes there, and the
  latest activity inside.
- Everything on the map can also be opened from the side panel with the keyboard.
  `Esc`, or clicking open grass, goes back to the guild.
- **Notices**: a toast and a short chime when a session needs you or finishes a turn.
  Click the toast to open that session. **Settings** turns the sound, "finished" and
  join/leave notices on or off, and can add desktop notifications while the tab is in the
  background. Settings are saved in your browser.
- A selection lives in the URL (`?select=hero:<id>` or `?select=building:forge`), so a
  reload keeps it.

## Status

- [x] Game rules, demo replay, CI with screenshots on every PR
- [x] Live sessions from Claude Code transcripts (read-only, 127.0.0.1, token)
- [x] Pixel-art village; clickable heroes and buildings with detail panels
- [x] Notices: toasts, sound, desktop notifications, settings
- [x] Chat with sessions from the browser; start new ones; Town Crier daily report
- [ ] Permission prompts as "needs you" (needs Claude Code hooks, opt-in)
- [ ] Visual regression baselines

## Credits

Pixel art from [Tiny Swords](https://pixelfrog-assets.itch.io/tiny-swords) by Pixel Frog
(CC0), and building art from [Agent Quest](https://github.com/FulAppiOS/Agent-Quest) (MIT).
Details in `web/public/assets/tiny-swords/CREDITS.md`.
