import { execFile } from 'node:child_process';
import { readFile, readdir, readlink, stat, mkdir, writeFile } from 'node:fs/promises';
import { platform } from 'node:os';
import { join, sep } from 'node:path';
import { promisify } from 'node:util';

/**
 * The Portal Keeper (docs/TOWER.md): every service the user's own processes are listening
 * on, found read-only from the operating system, so the Tower can show a portal for each.
 * No agent, no usage. On Linux and WSL from /proc; on macOS from `lsof`.
 *
 * For each listening port: the process's name and working folder, and (unless the user
 * turned it off) whether it answers HTTP, with its page title, from one GET to 127.0.0.1.
 */

export interface Listener {
  port: number;
  pid: number;
  command: string;
  cwd: string | null;
}

export interface Probe {
  http: boolean;
  status: number | null;
  title: string | null;
}

export interface Portal extends Listener, Partial<Probe> {
  /** The user's name for it, if they gave one. */
  name: string | null;
  pinned: boolean;
  /** The Knight working in the folder this service runs in, if any. */
  knight: { id: string; name: string } | null;
  /** The last part of its folder, for the page (never the whole path). */
  folder: string | null;
  since: number;
}

export interface PortalSettings {
  /** Check each new port with one GET to see whether it is a website. */
  probe: boolean;
  hidden: number[];
  pinned: number[];
  names: Record<string, string>;
}

export const DEFAULT_PORTAL_SETTINGS: PortalSettings = { probe: true, hidden: [], pinned: [], names: {} };

// ------------------------------------------------------------------ Linux and WSL: /proc

/** LISTEN sockets in a /proc/net/tcp or tcp6 table: their local port and socket inode. */
export function parseProcNetTcp(text: string): { port: number; inode: string }[] {
  const out: { port: number; inode: string }[] = [];
  for (const line of text.split('\n').slice(1)) {
    const cols = line.trim().split(/\s+/);
    // sl local_address rem_address st tx:rx tr:when retrnsmt uid timeout inode
    if (cols.length < 10 || cols[3] !== '0A') continue;
    const port = parseInt(cols[1]!.split(':').at(-1)!, 16);
    if (Number.isFinite(port) && port > 0) out.push({ port, inode: cols[9]! });
  }
  return out;
}

async function linuxListeners(proc = '/proc'): Promise<Listener[]> {
  const sockets = new Map<string, number>();
  for (const table of ['tcp', 'tcp6']) {
    const text = await readFile(join(proc, 'net', table), 'utf8').catch(() => '');
    for (const s of parseProcNetTcp(text)) sockets.set(s.inode, s.port);
  }
  if (sockets.size === 0) return [];
  const uid = process.getuid?.();
  const found = new Map<number, Listener>();
  for (const entry of await readdir(proc).catch(() => [] as string[])) {
    if (!/^\d+$/.test(entry)) continue;
    const dir = join(proc, entry);
    // Only the user's own processes.
    const owner = await stat(dir).then(
      (s) => s.uid,
      () => -1,
    );
    if (uid !== undefined && owner !== uid) continue;
    const fds = await readdir(join(dir, 'fd')).catch(() => [] as string[]);
    const ports: number[] = [];
    for (const fd of fds) {
      const link = await readlink(join(dir, 'fd', fd)).catch(() => '');
      const inode = /^socket:\[(\d+)\]$/.exec(link)?.[1];
      const port = inode ? sockets.get(inode) : undefined;
      if (port !== undefined) ports.push(port);
    }
    if (ports.length === 0) continue;
    const command = (await readFile(join(dir, 'comm'), 'utf8').catch(() => '')).trim() || '?';
    // A folder deleted while the process runs reads as "<path> (deleted)".
    const cwd = await readlink(join(dir, 'cwd')).then(
      (p) => p.replace(/ \(deleted\)$/, ''),
      () => null,
    );
    for (const port of ports)
      if (!found.has(port)) found.set(port, { port, pid: Number(entry), command, cwd });
  }
  return [...found.values()];
}

// ------------------------------------------------------------------ macOS: lsof

/** `lsof -nP -iTCP -sTCP:LISTEN -Fpcn` output: pid, command and the ports each listens on. */
export function parseLsof(text: string): { pid: number; command: string; port: number }[] {
  const out: { pid: number; command: string; port: number }[] = [];
  let pid = 0;
  let command = '?';
  for (const line of text.split('\n')) {
    const kind = line[0];
    const value = line.slice(1);
    if (kind === 'p') pid = Number(value);
    else if (kind === 'c') command = value;
    else if (kind === 'n') {
      const port = Number(/:(\d+)$/.exec(value)?.[1]);
      if (pid && port) out.push({ pid, command, port });
    }
  }
  return out;
}

const run = promisify(execFile);

async function macListeners(): Promise<Listener[]> {
  const { stdout } = await run('lsof', ['-nP', '-iTCP', '-sTCP:LISTEN', '-Fpcn']).catch(() => ({
    stdout: '',
  }));
  const rows = parseLsof(stdout);
  const pids = [...new Set(rows.map((r) => r.pid))];
  const cwds = new Map<number, string>();
  if (pids.length) {
    const { stdout: cwd } = await run('lsof', ['-a', '-p', pids.join(','), '-d', 'cwd', '-Fpn']).catch(
      () => ({
        stdout: '',
      }),
    );
    let pid = 0;
    for (const line of cwd.split('\n')) {
      if (line[0] === 'p') pid = Number(line.slice(1));
      else if (line[0] === 'n' && pid) cwds.set(pid, line.slice(1));
    }
  }
  const found = new Map<number, Listener>();
  for (const r of rows) if (!found.has(r.port)) found.set(r.port, { ...r, cwd: cwds.get(r.pid) ?? null });
  return [...found.values()];
}

/** Everything the user's processes are listening on, by port. */
export function listListeners(): Promise<Listener[]> {
  return platform() === 'darwin' ? macListeners() : linuxListeners();
}

// ------------------------------------------------------------------ is it a website?

/** One GET to the port on 127.0.0.1: does it answer HTTP, and what is its page called? */
export async function probe(port: number, timeoutMs = 1000): Promise<Probe> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/`, {
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
    });
    const type = res.headers.get('content-type') ?? '';
    let title: string | null = null;
    if (type.includes('html')) {
      const text = (await res.text()).slice(0, 64_000);
      title = /<title[^>]*>([^<]{1,200})<\/title>/i.exec(text)?.[1]?.trim() ?? null;
    } else await res.body?.cancel();
    return { http: true, status: res.status, title };
  } catch {
    return { http: false, status: null, title: null };
  }
}

// ------------------------------------------------------------------ the watcher

export interface PortWatcherOptions {
  dir: string;
  /** Never shown: the guild's own port. */
  ownPort: number;
  /** Folders sessions work in, newest first: a service in one belongs to that Knight. */
  knights: () => { id: string; name: string; cwd: string }[];
  list?: () => Promise<Listener[]>;
  probe?: (port: number) => Promise<Probe>;
  onChange?: (portals: Portal[]) => void;
  now?: () => number;
}

const inside = (child: string, parent: string) => child === parent || child.startsWith(parent + sep);

export class PortWatcher {
  settings: PortalSettings = { ...DEFAULT_PORTAL_SETTINGS };
  private readonly opts: PortWatcherOptions;
  private portals = new Map<number, Portal>();
  /** What a port answered, keyed by port and pid, so a restart is checked again. */
  private probed = new Map<string, Probe>();
  private timer: NodeJS.Timeout | null = null;
  private last = '';

  constructor(opts: PortWatcherOptions) {
    this.opts = opts;
  }

  private get file() {
    return join(this.opts.dir, 'portals.json');
  }

  async load(): Promise<void> {
    try {
      this.settings = {
        ...DEFAULT_PORTAL_SETTINGS,
        ...(JSON.parse(await readFile(this.file, 'utf8')) as object),
      };
    } catch {
      this.settings = { ...DEFAULT_PORTAL_SETTINGS };
    }
  }

  async update(patch: {
    probe?: unknown;
    port?: unknown;
    name?: unknown;
    hidden?: unknown;
    pinned?: unknown;
  }): Promise<PortalSettings> {
    const s = { ...this.settings, names: { ...this.settings.names } };
    if (patch.probe !== undefined) s.probe = Boolean(patch.probe);
    if (patch.port !== undefined) {
      const port = Number(patch.port);
      if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('No such port.');
      const toggle = (list: number[], on: unknown) =>
        on === undefined ? list : on ? [...new Set([...list, port])] : list.filter((p) => p !== port);
      s.hidden = toggle(s.hidden, patch.hidden);
      s.pinned = toggle(s.pinned, patch.pinned);
      if (patch.name !== undefined) {
        const name = String(patch.name).trim().slice(0, 40);
        if (name) s.names[port] = name;
        else delete s.names[port];
      }
    }
    this.settings = s;
    await mkdir(this.opts.dir, { recursive: true });
    await writeFile(this.file, JSON.stringify(s, null, 2) + '\n', { mode: 0o600 });
    await this.scan();
    return s;
  }

  /** The portals, pinned first, then by port; hidden ones are left out. */
  list(): Portal[] {
    return [...this.portals.values()]
      .filter((p) => !this.settings.hidden.includes(p.port))
      .sort((a, b) => Number(b.pinned) - Number(a.pinned) || a.port - b.port);
  }

  /** Ports the user hid, to show them again. */
  hidden(): number[] {
    return this.settings.hidden;
  }

  start(everyMs = 3000): void {
    void this.scan();
    this.timer = setInterval(() => void this.scan(), everyMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async scan(): Promise<Portal[]> {
    const listeners = (await (this.opts.list ?? listListeners)()).filter((l) => l.port !== this.opts.ownPort);
    const knights = this.opts.knights();
    const now = this.opts.now?.() ?? Date.now() / 1000;
    const next = new Map<number, Portal>();
    for (const l of listeners) {
      const key = `${l.port}:${l.pid}`;
      let answer = this.probed.get(key);
      if (!answer && this.settings.probe) {
        answer = await (this.opts.probe ?? probe)(l.port);
        this.probed.set(key, answer);
      }
      const knight = l.cwd ? knights.find((k) => inside(l.cwd!, k.cwd)) : undefined;
      const before = this.portals.get(l.port);
      next.set(l.port, {
        ...l,
        ...(this.settings.probe ? (answer ?? {}) : {}),
        name: this.settings.names[l.port] ?? null,
        pinned: this.settings.pinned.includes(l.port),
        knight: knight ? { id: knight.id, name: knight.name } : null,
        folder: l.cwd ? (l.cwd.split(sep).filter(Boolean).at(-1) ?? null) : null,
        since: before && before.pid === l.pid ? before.since : now,
      });
    }
    this.portals = next;
    const list = this.list();
    // Only the page's view of it (no pids or full folders) decides whether to announce.
    const shown = JSON.stringify(list.map(pagePortal)) + JSON.stringify(this.settings);
    if (shown !== this.last) {
      this.last = shown;
      this.opts.onChange?.(list);
    }
    return list;
  }
}

/** What the page gets: the folder's last part, never its path, and no process id. */
export function pagePortal(p: Portal) {
  return {
    port: p.port,
    command: p.command,
    folder: p.folder,
    knight: p.knight,
    http: p.http ?? null,
    status: p.status ?? null,
    title: p.title ?? null,
    name: p.name,
    pinned: p.pinned,
    since: p.since,
  };
}
