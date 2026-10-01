import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

import type { GuildEvent } from '@agent-guild/core';

import { registerChatRoutes } from './chatRoutes.ts';
import { ChatManager } from './chats.ts';
import { TownCrier } from './crier.ts';
import { createServer } from './server.ts';
import { TranscriptWatcher } from './watcher.ts';

/**
 * `npm start`: serve the guild, follow ~/.claude/projects, and run chats and the Town
 * Crier through the local `claude` CLI.
 *
 * Environment:
 *   AGENT_GUILD_PORT          default 4747
 *   AGENT_GUILD_TOKEN         default: a fresh random token each run
 *   CLAUDE_PROJECTS_DIR       default ~/.claude/projects
 *   AGENT_GUILD_MAX_AGE_HOURS sessions older than this are not loaded at startup (default 3, 0 = all)
 *   AGENT_GUILD_IDLE_MINUTES  a silent session leaves the guild after this (default 20, 0 = never)
 *   AGENT_GUILD_CLAUDE        the claude executable for chats (default "claude")
 *   AGENT_GUILD_DATA_DIR      Town Crier settings and reports (default ~/.agent-guild)
 *   AGENT_GUILD_HOME          sessions may only start inside this folder (default: your home)
 *   AGENT_GUILD_NO_CONTROL    set to 1 for watch-only: no chats, no Town Crier
 */

const port = Number(process.env.AGENT_GUILD_PORT ?? 4747);
const token = process.env.AGENT_GUILD_TOKEN ?? randomBytes(24).toString('hex');
const root = process.env.CLAUDE_PROJECTS_DIR ?? join(homedir(), '.claude', 'projects');
const maxAgeHours = Number(process.env.AGENT_GUILD_MAX_AGE_HOURS ?? 3);
const idleMinutes = Number(process.env.AGENT_GUILD_IDLE_MINUTES ?? 20);
const dataDir = process.env.AGENT_GUILD_DATA_DIR ?? join(homedir(), '.agent-guild');
const controlOn = process.env.AGENT_GUILD_NO_CONTROL !== '1';
const webDir = resolve(import.meta.dirname, '../../web/dist');

// Created before the server so the routes can use them; they announce through it once it
// exists.
let announce: (event: string, data: unknown) => void = () => {};
const chats = new ChatManager({
  spawn: (cmd, args, o) => spawn(cmd, args, { cwd: o.cwd, env: o.env, stdio: ['pipe', 'pipe', 'pipe'] }),
  claude: process.env.AGENT_GUILD_CLAUDE ?? 'claude',
  // Sessions may only start inside this folder. Tests point it at a scratch directory.
  ...(process.env.AGENT_GUILD_HOME ? { home: process.env.AGENT_GUILD_HOME } : {}),
  onList: (list) => announce('chats', list),
});
const crier = new TownCrier({ dir: dataDir, chats, onChange: () => announce('crier', crier.config) });
let publishEvents: (events: GuildEvent[]) => void = () => {};
const watcher = new TranscriptWatcher({
  root,
  maxAgeMs: maxAgeHours * 3_600_000,
  idleMs: idleMinutes * 60_000,
  onEvents: (e) => publishEvents(e),
});

const server = createServer({
  host: '127.0.0.1',
  token,
  webDir,
  ...(controlOn
    ? {
        control: (scope, isToken) =>
          registerChatRoutes(scope, {
            isToken,
            chats,
            crier,
            sessionOf: (id) => watcher.sessionOf(id),
            projects: () => watcher.projects(),
          }),
      }
    : {}),
});
publishEvents = server.publish;
announce = server.announce;
announce('control', { enabled: controlOn });

await server.app.listen({ host: '127.0.0.1', port });
watcher.start();
if (controlOn) {
  await crier.load();
  crier.start();
}

console.log(`Agent Guild is watching ${root}`);
if (controlOn)
  console.log(
    `Chats run through "${process.env.AGENT_GUILD_CLAUDE ?? 'claude'}"; Town Crier data in ${dataDir}`,
  );
console.log(`Open: http://127.0.0.1:${port}/?token=${token}`);

const shutdown = () => {
  watcher.stop();
  crier.stop();
  chats.stopAll();
  void server.app.close().then(() => process.exit(0));
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
