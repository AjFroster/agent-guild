import { randomUUID } from 'node:crypto';
import { realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, sep } from 'node:path';
import { createInterface } from 'node:readline';
import type { Readable, Writable } from 'node:stream';

import { type ChatItem, type ChatState, applyStreamLine, emptyChat } from '@agent-guild/core';

/**
 * Chats with Claude Code sessions, started from the browser.
 *
 * Each chat is a Claude Code session driven through the user's own `claude` CLI in
 * headless mode (`claude -p` with stream-json in and out), so it uses the same login and
 * settings as their terminal. A process stays up while the user is talking; when it ends
 * (idle, stopped, or the guild restarts) the next message resumes the same session id,
 * so a chat is never lost.
 *
 * This runs code on the machine: the routes in chatRoutes.ts require the token, and a new
 * chat may only start in an existing folder inside the home directory.
 */

export const CHAT_MODES = ['acceptEdits', 'plan', 'auto', 'default', 'bypassPermissions'] as const;
export type ChatMode = (typeof CHAT_MODES)[number];

export interface ChatInfo {
  /** The Claude session id, which is also the hero id in the guild. */
  id: string;
  name: string;
  cwd: string;
  mode: ChatMode;
  /** A claude process is attached right now. */
  running: boolean;
  /** A turn is in progress. */
  busy: boolean;
  loginRequired: boolean;
  startedAt: number;
}

/** The slice of a child process this module uses, so tests can pass a fake. */
export interface ChildLike {
  stdin: Writable;
  stdout: Readable;
  stderr: Readable;
  kill(signal?: NodeJS.Signals): boolean;
  on(event: 'exit', cb: (code: number | null) => void): this;
}

/** What a chat's subscribers hear: an item added or changed, one removed, or new info. */
export type ChatChange =
  { type: 'item'; item: ChatItem } | { type: 'remove'; id: string } | { type: 'info'; info: ChatInfo };

export type SpawnFn = (
  cmd: string,
  args: string[],
  opts: { cwd: string; env: NodeJS.ProcessEnv },
) => ChildLike;

export interface ChatOptions {
  spawn: SpawnFn;
  claude: string;
  home?: string;
  /** Close an idle process after this long; the next message resumes it. */
  idleMs?: number;
  maxRunning?: number;
  /**
   * How many helper processes (librarians, smiths, the Town Crier) may run at once. They
   * have their own pool, so a helper never closes a Knight's process to make room.
   */
  maxHelpers?: number;
  /** Allow "bypassPermissions". Off unless the guild was started with it on. */
  allowBypass?: boolean;
  onList?: (chats: ChatInfo[]) => void;
}

export interface StartRequest {
  cwd: string;
  name?: string;
  mode?: ChatMode;
  message: string;
  /** Extra flags for special sessions such as the Town Crier and the King. */
  allowedTools?: string[];
  appendSystemPrompt?: string;
  /** Path of an MCP config file whose servers this session gets. */
  mcpConfig?: string;
  /**
   * A utility's session rather than a Knight's: it runs in the helpers' own pool and its
   * process closes as soon as its turn ends (a later message resumes it).
   */
  helper?: boolean;
}

/** What a special session keeps when it is adopted again, e.g. after a restart. */
export type SessionExtras = Pick<StartRequest, 'mode' | 'allowedTools' | 'appendSystemPrompt' | 'mcpConfig'>;

/** How a turn ended for someone waiting on it. */
export interface TurnOutcome {
  /** False when the wait ran out with the turn still going. */
  done: boolean;
  /** What the assistant said this turn, joined; the result text if it said nothing. */
  reply: string;
  ok: boolean;
}

interface Chat {
  info: ChatInfo;
  state: ChatState;
  child: ChildLike | null;
  /** True until the first process has created the session on disk. */
  fresh: boolean;
  idleTimer: NodeJS.Timeout | null;
  /** When the chat last did anything (ms), for choosing which idle process to close. */
  lastActiveMs: number;
  listeners: Set<(change: ChatChange) => void>;
  allowedTools: string[];
  appendSystemPrompt: string | null;
  mcpConfig: string | null;
  helper: boolean;
}

export class ChatError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class ChatManager {
  private readonly chats = new Map<string, Chat>();
  private readonly opts: ChatOptions;

  constructor(opts: ChatOptions) {
    this.opts = opts;
  }

  list(): ChatInfo[] {
    return [...this.chats.values()].map((c) => ({ ...c.info }));
  }

  get(id: string): { info: ChatInfo; items: ChatItem[] } | null {
    const c = this.chats.get(id);
    return c ? { info: { ...c.info }, items: c.state.items } : null;
  }

  /** Start a new session in a folder and send its first message. */
  async start(req: StartRequest): Promise<ChatInfo> {
    const cwd = await this.checkFolder(req.cwd);
    const mode = req.mode ?? 'acceptEdits';
    this.checkMode(mode);
    if (!req.message?.trim()) throw new ChatError(400, 'Write a first message for the session.');
    const id = randomUUID();
    const chat = this.add({
      id,
      name: (req.name ?? '').trim().slice(0, 40) || basename(cwd),
      cwd,
      mode,
      fresh: true,
      items: [],
      allowedTools: req.allowedTools ?? [],
      appendSystemPrompt: req.appendSystemPrompt ?? null,
      mcpConfig: req.mcpConfig ?? null,
      helper: req.helper === true,
    });
    this.send(chat.info.id, req.message);
    return { ...chat.info };
  }

  /**
   * Open an existing session (started anywhere: a terminal, another guild run) so the
   * user can read it and continue it. `items` is its history from the transcript.
   */
  async adopt(
    id: string,
    cwd: string,
    name: string,
    items: ChatItem[],
    extras: SessionExtras = {},
  ): Promise<ChatInfo> {
    if (!UUID.test(id)) throw new ChatError(400, 'Not a session id.');
    const existing = this.chats.get(id);
    if (existing) return { ...existing.info };
    const folder = await this.checkFolder(cwd);
    const mode = extras.mode ?? 'acceptEdits';
    this.checkMode(mode);
    return {
      ...this.add({
        id,
        name,
        cwd: folder,
        mode,
        fresh: false,
        items,
        allowedTools: extras.allowedTools ?? [],
        appendSystemPrompt: extras.appendSystemPrompt ?? null,
        mcpConfig: extras.mcpConfig ?? null,
      }).info,
    };
  }

  /**
   * Wait for the chat's current turn to end, up to `ms`. Resolves at once when no turn
   * is running. The reply is everything the assistant said since the last user message.
   */
  waitForTurn(id: string, ms: number): Promise<TurnOutcome> {
    const chat = this.chats.get(id);
    if (!chat) return Promise.reject(new ChatError(404, 'No such chat.'));
    const outcome = (done: boolean): TurnOutcome => {
      const items = chat.state.items;
      let from = items.length;
      while (from > 0 && items[from - 1]!.kind !== 'user') from -= 1;
      const turn = items.slice(from);
      const said = turn
        .filter((i) => i.kind === 'assistant')
        .map((i) => i.text.trim())
        .filter(Boolean)
        .join('\n\n');
      const result = turn.findLast((i) => i.kind === 'result');
      const failed = turn.some(
        (i) => (i.kind === 'notice' && i.tone === 'error') || (i.kind === 'result' && !i.ok),
      );
      return { done, reply: said || (result?.kind === 'result' ? result.text : ''), ok: !failed };
    };
    if (!chat.info.busy) return Promise.resolve(outcome(true));
    return new Promise((resolve) => {
      const finish = (done: boolean) => {
        clearTimeout(timer);
        chat.listeners.delete(listen);
        resolve(outcome(done));
      };
      const listen = (change: ChatChange) => {
        if (change.type === 'info' && !change.info.busy) finish(true);
      };
      const timer = setTimeout(() => finish(false), ms);
      timer.unref?.();
      chat.listeners.add(listen);
    });
  }

  /** Send a message, starting or resuming the session's process if needed. */
  send(id: string, text: string, mode?: ChatMode): void {
    const chat = this.chats.get(id);
    if (!chat) throw new ChatError(404, 'No such chat.');
    const message = text.trim();
    if (!message) throw new ChatError(400, 'The message is empty.');
    if (mode !== undefined) {
      this.checkMode(mode);
      if (mode !== chat.info.mode && chat.child) this.close(chat); // a new mode needs a new process
      chat.info.mode = mode;
    }
    if (!chat.child) this.launch(chat);

    const now = Date.now() / 1000;
    this.push(chat, { kind: 'user', id: `u-${randomUUID()}`, t: now, text: message });
    // Busy until this turn's result. Set on the parsed state too: the output's first lines
    // (message_start) carry no busy signal, and copying the last turn's "done" from them
    // would end this turn before it began.
    chat.state = { ...chat.state, busy: true };
    chat.info.busy = true;
    chat.child!.stdin.write(
      JSON.stringify({
        type: 'user',
        message: { role: 'user', content: message },
        parent_tool_use_id: null,
      }) + '\n',
    );
    this.touch(chat);
    this.emitInfo(chat);
  }

  /** End the current turn and the process. The session stays and can be continued. */
  stop(id: string): boolean {
    const chat = this.chats.get(id);
    if (!chat?.child) return false;
    // SIGINT ends the turn cleanly; SIGTERM would leave it unfinished in the transcript.
    chat.child.kill('SIGINT');
    return true;
  }

  subscribe(id: string, fn: (change: ChatChange) => void): (() => void) | null {
    const chat = this.chats.get(id);
    if (!chat) return null;
    chat.listeners.add(fn);
    return () => chat.listeners.delete(fn);
  }

  stopAll(): void {
    for (const chat of this.chats.values()) if (chat.child) chat.child.kill('SIGINT');
  }

  private add(c: {
    id: string;
    name: string;
    cwd: string;
    mode: ChatMode;
    fresh: boolean;
    items: ChatItem[];
    allowedTools: string[];
    appendSystemPrompt: string | null;
    mcpConfig: string | null;
    helper?: boolean;
  }): Chat {
    const chat: Chat = {
      info: {
        id: c.id,
        name: c.name,
        cwd: c.cwd,
        mode: c.mode,
        running: false,
        busy: false,
        loginRequired: false,
        startedAt: Date.now() / 1000,
      },
      state: { ...emptyChat(), items: c.items },
      child: null,
      fresh: c.fresh,
      idleTimer: null,
      lastActiveMs: Date.now(),
      listeners: new Set(),
      allowedTools: c.allowedTools,
      appendSystemPrompt: c.appendSystemPrompt,
      mcpConfig: c.mcpConfig,
      helper: c.helper === true,
    };
    this.chats.set(c.id, chat);
    this.emitList();
    return chat;
  }

  private launch(chat: Chat): void {
    // Knights and helpers each have their own pool: neither closes the other's processes.
    const running = [...this.chats.values()].filter((c) => c.child && c.helper === chat.helper);
    const cap = chat.helper ? (this.opts.maxHelpers ?? 2) : (this.opts.maxRunning ?? 6);
    if (running.length >= cap) {
      // Make room by closing the process that has sat idle longest: its session is kept and
      // its next message resumes it. Only when every process is mid-turn is there no room.
      const idle = running.filter((c) => !c.info.busy).sort((a, b) => a.lastActiveMs - b.lastActiveMs)[0];
      if (!idle)
        throw new ChatError(
          429,
          chat.helper
            ? "The guild's helpers are all at work. Try again when one finishes."
            : 'Too many sessions are working at once. Stop one first.',
        );
      this.close(idle);
      this.emitInfo(idle);
    }
    const args = [
      '-p',
      '--input-format',
      'stream-json',
      '--output-format',
      'stream-json',
      '--verbose',
      '--include-partial-messages',
      '--permission-mode',
      chat.info.mode === 'default' ? 'default' : chat.info.mode,
      ...(chat.fresh ? ['--session-id', chat.info.id, '--name', chat.info.name] : ['--resume', chat.info.id]),
      ...(chat.allowedTools.length ? ['--allowedTools', chat.allowedTools.join(',')] : []),
      ...(chat.appendSystemPrompt ? ['--append-system-prompt', chat.appendSystemPrompt] : []),
      ...(chat.mcpConfig ? ['--mcp-config', chat.mcpConfig] : []),
    ];
    const child = this.opts.spawn(this.opts.claude, args, { cwd: chat.info.cwd, env: process.env });
    chat.child = child;
    chat.fresh = false;
    chat.info.running = true;

    createInterface({ input: child.stdout }).on('line', (raw) => {
      let line: unknown;
      try {
        line = JSON.parse(raw);
      } catch {
        return;
      }
      const before = chat.state.items;
      const wasBusy = chat.info.busy;
      chat.state = applyStreamLine(chat.state, line, Date.now() / 1000);
      chat.info.busy = chat.state.busy;
      chat.info.loginRequired = chat.state.loginRequired;
      for (const item of chat.state.items) {
        if (!before.includes(item)) this.emit(chat, item);
      }
      const kept = new Set(chat.state.items.map((x) => x.id));
      for (const item of before) {
        if (!kept.has(item.id)) this.notify(chat, { type: 'remove', id: item.id });
      }
      this.touch(chat);
      // A helper's work is one turn at a time: free its slot as soon as the turn ends.
      if (chat.helper && wasBusy && !chat.info.busy) this.close(chat);
      this.emitInfo(chat);
    });

    let stderr = '';
    child.stderr.on('data', (d: Buffer) => {
      stderr = (stderr + d.toString('utf8')).slice(-2000);
    });

    child.on('exit', (code) => {
      if (chat.child !== child) return;
      chat.child = null;
      chat.info.running = false;
      if (chat.info.busy) {
        chat.info.busy = false;
        this.push(chat, {
          kind: 'notice',
          id: `exit-${randomUUID()}`,
          t: Date.now() / 1000,
          tone: code === 0 || code === null ? 'info' : 'error',
          text:
            code === 0 || code === null || code === 130
              ? 'Stopped. Send a message to continue.'
              : `Claude Code exited with code ${code}.${stderr.trim() ? ` ${stderr.trim().split('\n').pop()}` : ''}`,
        });
      }
      if (chat.idleTimer) clearTimeout(chat.idleTimer);
      this.emitInfo(chat);
    });
  }

  private close(chat: Chat): void {
    if (!chat.child) return;
    chat.child.stdin.end();
    chat.child = null;
    chat.info.running = false;
  }

  /** Keep an active process; close it once it has sat idle (not mid-turn) too long. */
  private touch(chat: Chat): void {
    chat.lastActiveMs = Date.now();
    if (chat.idleTimer) clearTimeout(chat.idleTimer);
    chat.idleTimer = setTimeout(
      () => {
        if (!chat.info.busy) {
          this.close(chat);
          this.emitInfo(chat);
        }
      },
      this.opts.idleMs ?? 15 * 60_000,
    );
    chat.idleTimer.unref?.();
  }

  private push(chat: Chat, item: ChatItem): void {
    chat.state = { ...chat.state, items: [...chat.state.items, item] };
    this.emit(chat, item);
  }

  private emit(chat: Chat, item: ChatItem): void {
    this.notify(chat, { type: 'item', item });
  }

  private notify(chat: Chat, change: ChatChange): void {
    for (const l of chat.listeners) l(change);
  }

  private emitInfo(chat: Chat): void {
    this.notify(chat, { type: 'info', info: { ...chat.info } });
    this.emitList();
  }

  private emitList(): void {
    this.opts.onList?.(this.list());
  }

  private checkMode(mode: ChatMode): void {
    if (!CHAT_MODES.includes(mode)) throw new ChatError(400, `Unknown permission mode "${mode}".`);
    // Anyone holding the link could otherwise run any command on this machine unasked.
    if (mode === 'bypassPermissions' && !this.opts.allowBypass) {
      throw new ChatError(
        403,
        'Skipping permission checks is turned off. Start the guild with AGENT_GUILD_ALLOW_BYPASS=1 to allow it.',
      );
    }
  }

  /** An existing folder inside the home directory, resolved through symlinks; refuses anything else. */
  async checkFolder(raw: unknown): Promise<string> {
    if (typeof raw !== 'string' || !raw.trim()) throw new ChatError(400, 'Choose a folder to start in.');
    let real: string;
    try {
      real = await realpath(raw.trim());
      if (!(await stat(real)).isDirectory()) throw new Error('not a directory');
    } catch {
      throw new ChatError(400, `No folder at ${raw}.`);
    }
    // realpath first, so a symlink inside home cannot point the session somewhere else.
    const home = await realpath(this.opts.home ?? homedir());
    if (real !== home && !real.startsWith(home + sep)) {
      throw new ChatError(403, 'Sessions can only start in folders inside your home directory.');
    }
    return real;
  }
}
