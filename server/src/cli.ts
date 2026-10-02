import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

import { type GuildEvent, replay } from '@agent-guild/core';

import { Archive, waitingForUser } from './archive.ts';
import { registerChatRoutes, sessionOpener } from './chatRoutes.ts';
import { GitWatcher } from './git.ts';
import { ChatManager } from './chats.ts';
import { TownCrier } from './crier.ts';
import { Court } from './king.ts';
import { Library } from './library.ts';
import { registerKingRoutes } from './kingRoutes.ts';
import { registerLibraryRoutes } from './libraryRoutes.ts';
import { createServer } from './server.ts';
import { installSkill } from './install.ts';
import { installedSkills } from './skills.ts';
import { loadToken } from './token.ts';
import { TranscriptWatcher } from './watcher.ts';

/**
 * `npm start`: serve the guild, follow ~/.claude/projects, and run chats and the Town
 * Crier through the local `claude` CLI.
 *
 * Environment:
 *   AGENT_GUILD_PORT          default 4747
 *   AGENT_GUILD_TOKEN         default: kept in <data dir>/token, so the link stays the same
 *   CLAUDE_PROJECTS_DIR       default ~/.claude/projects
 *   AGENT_GUILD_MAX_AGE_HOURS sessions older than this are not loaded at startup (default 3, 0 = all)
 *   AGENT_GUILD_IDLE_MINUTES  a silent session leaves the guild after this (default 20, 0 = never)
 *   AGENT_GUILD_CLAUDE        the claude executable for chats (default "claude")
 *   AGENT_GUILD_DATA_DIR      Town Crier settings and reports (default ~/.agent-guild)
 *   AGENT_GUILD_HOME          sessions may only start inside this folder (default: your home)
 *   AGENT_GUILD_NO_CONTROL    set to 1 for watch-only: no chats, no Town Crier
 *   AGENT_GUILD_ALLOW_BYPASS  set to 1 to offer "skip all permission checks" for new chats
 *   AGENT_GUILD_GIT           set to 0 to stop checking session folders for unpushed work
 *   CLAUDE_SKILLS_DIR         installed skills, compared against new ones (default ~/.claude/skills)
 *   CLAUDE_PLUGINS_DIR        plugins whose skills count as installed (default ~/.claude/plugins)
 */

const port = Number(process.env.AGENT_GUILD_PORT ?? 4747);
const root = process.env.CLAUDE_PROJECTS_DIR ?? join(homedir(), '.claude', 'projects');
const maxAgeHours = Number(process.env.AGENT_GUILD_MAX_AGE_HOURS ?? 3);
const idleMinutes = Number(process.env.AGENT_GUILD_IDLE_MINUTES ?? 20);
const dataDir = process.env.AGENT_GUILD_DATA_DIR ?? join(homedir(), '.agent-guild');
const controlOn = process.env.AGENT_GUILD_NO_CONTROL !== '1';
const allowBypass = process.env.AGENT_GUILD_ALLOW_BYPASS === '1';
const token = process.env.AGENT_GUILD_TOKEN ?? (await loadToken(join(dataDir, 'token')));
const webDir = resolve(import.meta.dirname, '../../web/dist');
const skillsDir = process.env.CLAUDE_SKILLS_DIR ?? join(homedir(), '.claude', 'skills');
const pluginsDir = process.env.CLAUDE_PLUGINS_DIR ?? join(homedir(), '.claude', 'plugins');

// Created before the server so the routes can use them; they announce through it once it
// exists.
let announce: (event: string, data: unknown) => void = () => {};
const chats = new ChatManager({
  spawn: (cmd, args, o) => spawn(cmd, args, { cwd: o.cwd, env: o.env, stdio: ['pipe', 'pipe', 'pipe'] }),
  claude: process.env.AGENT_GUILD_CLAUDE ?? 'claude',
  // Sessions may only start inside this folder. Tests point it at a scratch directory.
  ...(process.env.AGENT_GUILD_HOME ? { home: process.env.AGENT_GUILD_HOME } : {}),
  allowBypass,
  onList: (list) => announce('chats', list),
});
const crier = new TownCrier({ dir: dataDir, chats, onChange: () => announce('crier', crier.config) });
let publishEvents: (events: GuildEvent[]) => void = () => {};
let guildEvents: () => readonly GuildEvent[] = () => [];
// Filled in once the court exists: the King's session gets a crown as it walks in.
let kingId: () => string | null = () => null;
let commanded: (id: string) => boolean = () => false;
let isLibrarian: (id: string) => boolean = () => false;
/**
 * The King's session gets its crown as it walks in, and a Knight he has commanded its
 * mark, including one he raised whose session had not started yet when he gave the order.
 */
const crowned = (events: GuildEvent[]): GuildEvent[] =>
  events.flatMap((e): GuildEvent[] => {
    if (e.type !== 'session_start') return [e];
    if (e.session === kingId()) return [e, { t: e.t, session: e.session, type: 'crown' }];
    if (commanded(e.session)) return [e, { t: e.t, session: e.session, type: 'commanded' }];
    if (isLibrarian(e.session)) return [e, { t: e.t, session: e.session, type: 'librarian' }];
    return [e];
  });
const watcher = new TranscriptWatcher({
  root,
  maxAgeMs: maxAgeHours * 3_600_000,
  idleMs: idleMinutes * 60_000,
  onEvents: (e) => publishEvents(crowned(e)),
});

const open = sessionOpener(
  chats,
  (id) => watcher.sessionOf(id),
  (id) => (id === court.kingId ? court.extras() : undefined),
);
const court = new Court({
  dir: dataDir,
  chats,
  state: () => replay(guildEvents()),
  sessionOf: (id) => watcher.sessionOf(id),
  lastWrite: (id) => watcher.lastWrite(id),
  open,
  guildUrl: `http://127.0.0.1:${port}`,
  token,
  onChange: () => announce('king', { id: court.kingId }),
  onCommand: (id) => publishEvents([{ t: Date.now() / 1000, session: id, type: 'commanded' }]),
});
kingId = () => court.kingId;
commanded = (id) => court.commanded.has(id);

// The librarians: the Scout and the Reviewer, once a day when the user turns them on.
const library = new Library({
  dir: dataDir,
  chats,
  guildUrl: `http://127.0.0.1:${port}`,
  token,
  onChange: () => announceSkills(),
  onLibrarian: (id) => publishEvents([{ t: Date.now() / 1000, session: id, type: 'librarian' }]),
  onError: (message) => void archive.addNote('Library', message).then(announceSkills),
});
isLibrarian = (id) => library.config.sessions.includes(id);

// The Library: the Archive of reviewed skills, compared against the installed ones.
const archive = new Archive(join(dataDir, 'archive.json'));
const announceSkills = () =>
  void archive.read().then(({ entries }) => announce('skills', { waiting: waitingForUser(entries).length }));

// Unpushed commits and uncommitted files in the folders sessions ran in: counts only.
const git =
  process.env.AGENT_GUILD_GIT === '0'
    ? null
    : new GitWatcher({ sessions: () => watcher.sessionFolders(), onEvents: (e) => publishEvents(e) });

const server = createServer({
  host: '127.0.0.1',
  token,
  webDir,
  ...(controlOn
    ? {
        control: async (scope, isToken) => {
          await registerChatRoutes(scope, {
            isToken,
            chats,
            crier,
            sessionOf: (id) => watcher.sessionOf(id),
            projects: () => watcher.projects(),
            extrasFor: (id) => (id === court.kingId ? court.extras() : undefined),
          });
          await registerKingRoutes(scope, {
            isToken,
            court,
            archive: async () => {
              const { entries, notes } = await archive.read();
              return {
                installed: (await installedSkills(skillsDir, pluginsDir)).map((s) => ({
                  name: s.name,
                  description: s.description,
                })),
                recentlyAdopted: entries
                  .filter((e) => e.status === 'installed')
                  .slice(0, 10)
                  .map((e) => ({ name: e.name, why: e.review?.reason ?? '' })),
                // Not usable until the user installs them; listed so the King knows they exist.
                awaitingTheUser: waitingForUser(entries).map((e) => e.name),
                notes: notes.slice(0, 3),
              };
            },
          });
          await registerLibraryRoutes(scope, {
            isToken,
            archive,
            installed: () => installedSkills(skillsDir, pluginsDir),
            onChange: announceSkills,
            library,
            install: (entry) =>
              installSkill(entry, {
                skillsDir,
                // Tests point this at local repositories; in use it is always GitHub.
                ...(process.env.AGENT_GUILD_SKILL_GIT_BASE
                  ? { gitBase: process.env.AGENT_GUILD_SKILL_GIT_BASE }
                  : {}),
              }),
          });
        },
      }
    : {}),
});
publishEvents = server.publish;
announce = server.announce;
guildEvents = server.events;
announce('control', { enabled: controlOn, allowBypass: controlOn && allowBypass });

await server.app.listen({ host: '127.0.0.1', port });
// Before the first scan, so the King and the librarians are known as they are read in.
if (controlOn) {
  await court.load();
  await library.load();
}
watcher.start();
git?.start();
if (controlOn) {
  await crier.load();
  crier.start();
  library.start();
  announce('king', { id: court.kingId });
  announceSkills();
}

console.log(`Agent Guild is watching ${root}`);
if (controlOn)
  console.log(
    `Chats run through "${process.env.AGENT_GUILD_CLAUDE ?? 'claude'}"; Town Crier data in ${dataDir}`,
  );
console.log(`Open: http://127.0.0.1:${port}/?token=${token}`);

const shutdown = () => {
  watcher.stop();
  git?.stop();
  crier.stop();
  library.stop();
  chats.stopAll();
  void server.app.close().then(() => process.exit(0));
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
