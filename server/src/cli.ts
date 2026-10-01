import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

import { type GuildEvent, replay } from '@agent-guild/core';

import { registerChatRoutes, sessionOpener } from './chatRoutes.ts';
import { GitWatcher } from './git.ts';
import { ChatManager } from './chats.ts';
import { TownCrier } from './crier.ts';
import { Court } from './king.ts';
import { registerKingRoutes } from './kingRoutes.ts';
import { createServer } from './server.ts';
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
const crowned = (events: GuildEvent[]): GuildEvent[] =>
  events.flatMap((e) =>
    e.type === 'session_start' && e.session === kingId()
      ? [e, { t: e.t, session: e.session, type: 'crown' }]
      : [e],
  );
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
  onChange: () => announce('king', { id: court.kingId, commanded: [...court.commanded] }),
});
kingId = () => court.kingId;

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
          await registerKingRoutes(scope, { isToken, court });
        },
      }
    : {}),
});
publishEvents = server.publish;
announce = server.announce;
guildEvents = server.events;
announce('control', { enabled: controlOn, allowBypass: controlOn && allowBypass });

await server.app.listen({ host: '127.0.0.1', port });
// Before the first scan, so the King's session gets its crown as it is read in.
if (controlOn) await court.load();
watcher.start();
git?.start();
if (controlOn) {
  await crier.load();
  crier.start();
  announce('king', { id: court.kingId, commanded: [] });
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
  chats.stopAll();
  void server.app.close().then(() => process.exit(0));
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
