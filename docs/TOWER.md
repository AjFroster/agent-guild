# The Tower

Where knowledge from beyond the village comes from. Knights already climb it when they
search or read the web. Its wizards serve the Knights the way the smiths do: they think,
look and advise so the Knights can stay in the fight, and they return words and links,
never edits.

Wizards are Tiny Swords blue Pawns wearing hats drawn for them (`scripts/art/props.py`).

| Wizard            | Does                                                                            | Costs usage |
| ----------------- | ------------------------------------------------------------------------------- | ----------- |
| **Portal Keeper** | A portal for every service listening on a local port; click to open it          | No          |
| **Seer**          | Researches a Knight's question on the web and in docs; answers with sources     | Yes         |
| **Archmage**      | Counsel for a stuck Knight, on a stronger model; advice only, never edits       | Yes         |
| **Enchanter**     | "Identify": a fresh-eyes review of a Knight's changes before it calls them done | Yes         |
| **Lookout**       | Watches CI, pull requests and advisories on a schedule; raises alerts           | Yes         |

## The Portal Keeper (no agent, no usage)

The guild itself finds what is listening, so portals are instant and free.

- **Finding ports** (`server/src/ports.ts`, polled every few seconds, read-only): on Linux
  and WSL, `/proc/net/tcp` and `tcp6` (sockets in LISTEN), each socket's inode matched to
  its process through `/proc/<pid>/fd`; on macOS, `lsof -nP -iTCP -sTCP:LISTEN`. Only the
  user's own processes. For each: the port, the process name (`vite`, `node`, `python`),
  and its working folder.
- **Which Knight it belongs to**: a process whose folder is a Knight's folder (or inside
  it) is that Knight's portal (purple, and on the map it stands by that Knight's project).
- **Is it a website**: one `GET /` to `127.0.0.1:<port>`, with a 1-second timeout, reading
  the status and the page's `<title>`. A port that answers HTTP gets a green portal; one
  that does not (a database, say) shows as a plain stone arch with its name, and is never
  probed again until it restarts. Probing can be turned off in Settings.
- **Opening**: a portal is a link to `http://localhost:<port>/`, opened in a new tab. The
  guild never proxies or reads the pages beyond that first title.
- **Leaving out**: the guild's own port, and anything the user hides. The user can rename
  and pin portals (kept in the guild's data folder).
- **Privacy**: ports, process names and folder names reach the page only behind the token,
  like chat folders already do. Nothing leaves 127.0.0.1.
- **On the map**: a small portal stone beside the Tower counts open portals; a Knight with
  a running dev server gets a portal glyph over its head that opens it.

## The Seer, the Archmage and the Enchanter (asked by Knights)

Each is a role on the guild's MCP server, like the Forge's (`kingMcp.ts`), and a tool for
the Knights the guild starts (the `knight` role):

- `ask_seer(question)`: the Seer (`WebSearch`, `WebFetch` only) answers with a short scroll:
  the answer, then its sources. Scrolls are kept on the scroll rack (`tower.json`), so the
  next Knight asking the same thing gets it at once, and the King can read them.
- `consult_archmage(problem)`: the Archmage runs on a stronger model than the Knights (set in
  the Tower's settings), reads the Knight's folder (read-only tools) and its recent turns,
  and returns advice. A Knight is nudged to call it after repeated failures in a row.
- `request_identify()`: the Enchanter reads the Knight's uncommitted changes (`git diff`,
  read-only) with fresh context and returns findings: bugs, missing tests, risky changes.

Each answer comes back to the Knight as the tool's result (the tool waits, up to a limit,
like the King's orders), so the Knight carries on with it in hand.

## The Lookout (scheduled, off until turned on)

Like the librarians: once an hour or once a day, when the user turns it on. With `gh` it
reads CI on the user's open branches, new reviews on their pull requests, and advisories
for their projects' dependencies. It rings the bell: a "needs you" notice, and, when the
King is crowned, a note to the King to give the work to a Knight (or to the Armorer, once
he is hired). It changes nothing itself.

## The Tower page

A Tiny Swords scene (mock-up approved first): the Tower on its terrace; the Seer at the
scrying pool, with the telescope and the scroll rack; the Archmage at the star-chart desk
with the crystal and floating books; the Enchanter with the lens of identify; the Lookout
at the bell; and in front, the Portal Keeper's plaza, one portal per port on a rune circle.
Below: the portals as a list (name, port, process, project, title, open/rename/hide), the
scroll rack, and each wizard's desk.

## Status

Done: phase 1, the portals (and the Tower page with its scene). Next: the Seer.

## Phases

1. **Portals**: `ports.ts` (Linux/WSL and macOS, unit-tested on fixtures of `/proc` and
   `lsof` output), the routes, the Tower page and scene with the portal plaza, portals on
   the map. A browser test starts a small HTTP server and a plain TCP listener and checks
   one green portal that opens it and one stone arch.
2. **The Seer** and the scroll rack.
3. **The Archmage**, with a model setting and the nudge after repeated failures.
4. **The Enchanter**.
5. **The Lookout**.

Each phase: the stand-in CLI plays the new wizard in browser tests, as for the Forge, and
a captioned screenshot tour goes to the user before merging.
