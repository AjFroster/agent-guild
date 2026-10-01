import { open, readFile, readdir, stat } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

import {
  type GuildEvent,
  type Tokens,
  eventsFromLine,
  lineTime,
  sessionName,
  subagentName,
} from '@agent-guild/core';

/**
 * Follows Claude Code transcripts under a projects directory and turns new lines into
 * guild events. Read-only: it never writes to the directory or to Claude's settings.
 *
 *   <root>/<project>/<session>.jsonl                          a main session
 *   <root>/<project>/<session>/subagents/agent-<id>.jsonl     one of its sub-agents
 *   <root>/<project>/<session>/subagents/agent-<id>.meta.json the sub-agent's description
 */

export interface WatcherOptions {
  root: string;
  /** Ignore transcripts not written to within this window when first seen. 0 = no limit. */
  maxAgeMs: number;
  /** A transcript silent for this long counts as a session that has left. 0 = never. */
  idleMs: number;
  onEvents: (events: GuildEvent[]) => void;
  now?: () => number;
}

interface Tracked {
  session: string;
  offset: number;
  /** Bytes after the last newline: a line still being written. */
  partial: string;
  started: boolean;
  ended: boolean;
  isSubagent: boolean;
  parent: string | null;
  /** The file's mtime at the last scan, for the idle rule. */
  lastWriteMs: number;
  /** Chosen once, so a session that goes idle and comes back keeps its name. */
  name: string | null;
  /** Latest line timestamp seen, in epoch seconds. */
  lastT: number;
  /** Last model/branch sent, so a meta event goes out only when one changes. */
  lastMeta: string;
  /** The folder the session runs in. Kept on the server for chats; never broadcast. */
  cwd: string | null;
  file: string;
  /** Usage counted per reply, so a reply split over several lines counts once. */
  usage: Map<string, Tokens>;
}

const MAX_READ = 8 * 1024 * 1024;

export class TranscriptWatcher {
  private readonly tracked = new Map<string, Tracked>();
  private readonly names = new Map<string, number>();
  private timer: NodeJS.Timeout | null = null;
  private scanning = false;
  private readonly now: () => number;
  private readonly opts: WatcherOptions;

  constructor(opts: WatcherOptions) {
    this.opts = opts;
    this.now = opts.now ?? Date.now;
  }

  start(pollMs = 1000): void {
    void this.scan();
    this.timer = setInterval(() => void this.scan(), pollMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** One pass over the directory. Public so tests can drive it without timers. */
  async scan(): Promise<void> {
    if (this.scanning) return;
    this.scanning = true;
    try {
      const files = await this.listTranscripts();
      // Main sessions before sub-agents, so a party member's leader already exists.
      files.sort((a, b) => Number(a.includes('/subagents/')) - Number(b.includes('/subagents/')));
      for (const file of files) await this.readFile(file);
      this.markIdle();
    } finally {
      this.scanning = false;
    }
  }

  private async listTranscripts(): Promise<string[]> {
    const out: string[] = [];
    for (const project of await entries(this.opts.root)) {
      if (!project.isDirectory()) continue;
      const projectDir = join(this.opts.root, project.name);
      for (const entry of await entries(projectDir)) {
        const full = join(projectDir, entry.name);
        if (entry.isFile() && entry.name.endsWith('.jsonl')) out.push(full);
        if (entry.isDirectory()) {
          for (const sub of await entries(join(full, 'subagents'))) {
            if (sub.isFile() && sub.name.startsWith('agent-') && sub.name.endsWith('.jsonl')) {
              out.push(join(full, 'subagents', sub.name));
            }
          }
        }
      }
    }
    return out;
  }

  private async readFile(file: string): Promise<void> {
    let info;
    try {
      info = await stat(file);
    } catch {
      return;
    }
    let tracked = this.tracked.get(file);
    if (!tracked) {
      if (this.opts.maxAgeMs > 0 && this.now() - info.mtimeMs > this.opts.maxAgeMs) return;
      tracked = this.track(file);
    }
    tracked.lastWriteMs = info.mtimeMs;
    if (info.size < tracked.offset) {
      // Truncated or replaced: start over rather than reading from the middle of a line.
      tracked.offset = 0;
      tracked.partial = '';
    }
    if (info.size === tracked.offset) return;

    const length = Math.min(info.size - tracked.offset, MAX_READ);
    const handle = await open(file, 'r');
    let chunk: string;
    try {
      const buf = Buffer.alloc(length);
      await handle.read(buf, 0, length, tracked.offset);
      chunk = buf.toString('utf8');
    } finally {
      await handle.close();
    }
    tracked.offset += length;

    const text = tracked.partial + chunk;
    const lines = text.split('\n');
    tracked.partial = lines.pop() ?? '';

    const parsed: Record<string, unknown>[] = [];
    for (const raw of lines) {
      if (!raw.trim()) continue;
      try {
        const obj: unknown = JSON.parse(raw);
        if (typeof obj === 'object' && obj !== null) parsed.push(obj as Record<string, unknown>);
      } catch {
        // A corrupt line is skipped, not fatal: the next one is independent.
      }
    }
    if (parsed.length === 0) return;

    if (!tracked.cwd) {
      const cwd = parsed.find((l) => typeof l.cwd === 'string')?.cwd;
      if (typeof cwd === 'string') tracked.cwd = cwd;
    }

    const events: GuildEvent[] = [];
    if (!tracked.started || tracked.ended) {
      const first = parsed.find((l) => lineTime(l) !== null);
      if (!first) return;
      events.push(await this.startEvent(file, tracked, lineTime(first)!, parsed));
      tracked.started = true;
      tracked.ended = false;
    }
    for (const line of parsed) {
      for (const e of eventsFromLine(line, { session: tracked.session, usage: tracked.usage })) {
        if (e.type === 'meta') {
          // Every assistant line carries these; forward only a change.
          const key = `${e.model ?? ''}\n${e.branch ?? ''}`;
          if (key === tracked.lastMeta) continue;
          tracked.lastMeta = key;
        }
        events.push(e);
      }
    }
    for (const e of events) tracked.lastT = Math.max(tracked.lastT, e.t);
    this.opts.onEvents(events);
  }

  private track(file: string): Tracked {
    const isSubagent = basename(dirname(file)) === 'subagents';
    const session = basename(file, '.jsonl');
    const parent = isSubagent ? basename(dirname(dirname(file))) : null;
    const tracked: Tracked = {
      session,
      offset: 0,
      partial: '',
      started: false,
      ended: false,
      isSubagent,
      parent,
      lastWriteMs: 0,
      name: null,
      lastT: 0,
      lastMeta: '',
      cwd: null,
      file,
      usage: new Map(),
    };
    this.tracked.set(file, tracked);
    return tracked;
  }

  private async startEvent(
    file: string,
    tracked: Tracked,
    t: number,
    lines: Record<string, unknown>[],
  ): Promise<GuildEvent> {
    if (tracked.isSubagent && tracked.parent) {
      let meta: unknown = null;
      try {
        meta = JSON.parse(await readFile(file.replace(/\.jsonl$/, '.meta.json'), 'utf8'));
      } catch {
        // No meta file: fall back to a generic name.
      }
      return {
        t,
        session: tracked.session,
        type: 'subagent_start',
        parent: tracked.parent,
        name: subagentName(meta, 'Helper'),
      };
    }
    const cwd = lines.find((l) => typeof l.cwd === 'string')?.cwd;
    // A session given a name (`claude --name`, or one started from the guild) uses it.
    const title = lines.find(
      (l) => l.type === 'custom-title' && typeof l.customTitle === 'string',
    )?.customTitle;
    tracked.name ??= this.uniqueName(
      typeof title === 'string' && title.trim() ? title.trim().slice(0, 40) : sessionName(cwd, 'Session'),
    );
    return { t, session: tracked.session, type: 'session_start', name: tracked.name };
  }

  /** Where a main session runs and where its transcript is, if the guild has seen it. */
  sessionOf(session: string): { cwd: string | null; file: string; name: string | null } | null {
    for (const t of this.tracked.values()) {
      if (t.session === session && !t.isSubagent) return { cwd: t.cwd, file: t.file, name: t.name };
    }
    return null;
  }

  /**
   * Main sessions the guild has seen, gone ones included, with the folder they ran in:
   * the most recently written `limit` of them, for the git check.
   */
  sessionFolders(limit = 30): { session: string; cwd: string }[] {
    return [...this.tracked.values()]
      .filter((t) => t.started && !t.isSubagent && t.cwd)
      .sort((a, b) => b.lastWriteMs - a.lastWriteMs)
      .slice(0, limit)
      .map((t) => ({ session: t.session, cwd: t.cwd! }));
  }

  /** When a main session's transcript last changed (epoch ms), or null if unknown. */
  lastWrite(session: string): number | null {
    for (const t of this.tracked.values()) {
      if (t.session === session && !t.isSubagent) return t.lastWriteMs;
    }
    return null;
  }

  /** Folders sessions have run in, most recently active first: suggestions for a new chat. */
  projects(): string[] {
    const seen = new Map<string, number>();
    for (const t of this.tracked.values()) {
      if (t.cwd && !t.isSubagent) seen.set(t.cwd, Math.max(seen.get(t.cwd) ?? 0, t.lastWriteMs));
    }
    return [...seen.entries()].sort((a, b) => b[1] - a[1]).map(([cwd]) => cwd);
  }

  /** Two sessions in the same project get "project" and "project 2". */
  private uniqueName(name: string): string {
    const n = (this.names.get(name) ?? 0) + 1;
    this.names.set(name, n);
    return n === 1 ? name : `${name.slice(0, 37)} ${n}`;
  }

  private markIdle(): void {
    if (this.opts.idleMs <= 0) return;
    const now = this.now();
    const ended: GuildEvent[] = [];
    for (const tracked of this.tracked.values()) {
      if (!tracked.started || tracked.ended) continue;
      if (now - tracked.lastWriteMs > this.opts.idleMs) {
        tracked.ended = true;
        // Stamped just after the session's own last line, not with the wall clock: replay
        // orders by t, and a clock-stamped end could sort after the lines that resume it.
        ended.push({
          t: tracked.lastT + 0.001,
          session: tracked.session,
          type: tracked.isSubagent ? 'subagent_stop' : 'session_end',
        });
      }
    }
    if (ended.length > 0) this.opts.onEvents(ended);
  }
}

async function entries(dir: string) {
  try {
    return await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}
