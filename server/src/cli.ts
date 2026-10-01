import { randomBytes } from 'node:crypto';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

import { createServer } from './server.ts';
import { TranscriptWatcher } from './watcher.ts';

/**
 * `npm start`: serve the guild and follow ~/.claude/projects.
 *
 * Environment:
 *   AGENT_GUILD_PORT          default 4747
 *   AGENT_GUILD_TOKEN         default: a fresh random token each run
 *   CLAUDE_PROJECTS_DIR       default ~/.claude/projects
 *   AGENT_GUILD_MAX_AGE_HOURS sessions older than this are not loaded at startup (default 3, 0 = all)
 *   AGENT_GUILD_IDLE_MINUTES  a silent session leaves the guild after this (default 20, 0 = never)
 */

const port = Number(process.env.AGENT_GUILD_PORT ?? 4747);
const token = process.env.AGENT_GUILD_TOKEN ?? randomBytes(24).toString('hex');
const root = process.env.CLAUDE_PROJECTS_DIR ?? join(homedir(), '.claude', 'projects');
const maxAgeHours = Number(process.env.AGENT_GUILD_MAX_AGE_HOURS ?? 3);
const idleMinutes = Number(process.env.AGENT_GUILD_IDLE_MINUTES ?? 20);
const webDir = resolve(import.meta.dirname, '../../web/dist');

const { app, publish } = createServer({ host: 'localhost', token, webDir });
const watcher = new TranscriptWatcher({
  root,
  maxAgeMs: maxAgeHours * 3_600_000,
  idleMs: idleMinutes * 60_000,
  onEvents: publish,
});

await app.listen({ host: 'localhost', port });
watcher.start();

console.log(`Agent Guild is watching ${root}`);
// `localhost`, not 127.0.0.1: from Windows, WSL only forwards the ::1 socket, which a
// browser reaches through the name.
console.log(`Open: http://localhost:${port}/?token=${token}`);

const shutdown = () => {
  watcher.stop();
  void app.close().then(() => process.exit(0));
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
