import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import {
  type ChatItem,
  type GuildState,
  type Hero,
  hasLooseEnds,
  rankOf,
  roster,
  totalTokens,
} from '@agent-guild/core';

import { type ChatManager, ChatError, type ChatMode, type SessionExtras, type TurnOutcome } from './chats.ts';

/**
 * The King: one Claude Code session the user talks to, which gets work done by giving
 * orders to Knights (other sessions) through the guild's MCP tools (kingMcp.ts).
 *
 * The King is an orchestrator, not a worker: it may read files to understand a request,
 * but it cannot edit files or run commands, and the only way it changes anything is by
 * ordering a Knight, which works under its own permission mode. This file holds the
 * rules for that, so they hold whatever the King's model decides:
 *
 * - A Knight mid-turn is not interrupted with a new order.
 * - A session someone is using in a terminal right now is not talked over.
 * - The King cannot order itself, or skip permission checks (ChatManager refuses that
 *   unless the guild was started to allow it).
 */

export const KING_TOOLS = ['mcp__guild', 'Read', 'Glob', 'Grep'];

export const KING_PROMPT = [
  "You are the King of an Agent Guild, the user's orchestrator. The user talks to you; you get work done through Knights.",
  'A Knight is a Claude Code session working in one project folder, with its own context, tools and party of sub-agents (Footsoldiers that change things, Workers that read and search). Knights cannot see this conversation.',
  '',
  'How you rule:',
  '- Start with list_knights to see the kingdom.',
  '- Break the request into orders. Give each to the Knight already working in that folder (command_knight). Raise a new Knight (raise_knight) only for work no Knight covers, and ask the user first before raising one in a folder they have not named.',
  '- Write each order as a complete instruction: the goal, what done looks like, and what to report back.',
  '- Independent orders can run at once: send them with wait_seconds 0, then follow up with read_knight.',
  '- You do not edit files or run commands yourself. You may read files to understand a request.',
  '- Check each answer against its order. Report to the user briefly: what each Knight did, what is left, and anything that needs their decision.',
  '- Never order a Knight to push to a protected branch, delete work, or skip permission checks without the user saying so.',
].join('\n');

/** How long a terminal session must be quiet before the King may give it an order. */
const TERMINAL_QUIET_MS = 90_000;
const DEFAULT_WAIT_S = 120;
const MAX_WAIT_S = 240;

export interface CourtOptions {
  /** Data directory: the King's record, its MCP config and its throne-room folder. */
  dir: string;
  chats: ChatManager;
  /** The guild as it stands, replayed from the server's events. */
  state: () => GuildState;
  /** Where a session runs, from the watcher. Folders go to the King, never to the page. */
  sessionOf: (id: string) => { cwd: string | null; file: string; name: string | null } | null;
  /** When a session's transcript last changed (epoch ms). */
  lastWrite: (id: string) => number | null;
  /** Load a session into the chat manager (chatRoutes.sessionOpener). */
  open: (id: string) => Promise<unknown>;
  /** The guild's own address and token, for the King's MCP server. */
  guildUrl: string;
  token: string;
  now?: () => number;
  onChange?: () => void;
  /** A Knight has just been given an order. */
  onCommand?: (id: string) => void;
}

export interface Order {
  order: string;
  waitSeconds?: unknown;
}

export interface RaiseOrder extends Order {
  folder: string;
  name: string;
  mode?: ChatMode;
}

export class Court {
  kingId: string | null = null;
  /** Knights the King has given orders to, for drawing the chain of command. */
  readonly commanded = new Set<string>();
  private readonly opts: CourtOptions;

  constructor(opts: CourtOptions) {
    this.opts = opts;
  }

  private get recordFile() {
    return join(this.opts.dir, 'king.json');
  }

  get mcpConfigFile() {
    return join(this.opts.dir, 'king-mcp.json');
  }

  get throneRoom() {
    return join(this.opts.dir, 'throne-room');
  }

  async load(): Promise<void> {
    try {
      const raw = JSON.parse(await readFile(this.recordFile, 'utf8')) as { id?: unknown };
      this.kingId = typeof raw.id === 'string' ? raw.id : null;
    } catch {
      this.kingId = null;
    }
  }

  /** What the King's session runs with, on first start and whenever it is reopened. */
  extras(): SessionExtras {
    return {
      mode: 'default',
      allowedTools: KING_TOOLS,
      appendSystemPrompt: KING_PROMPT,
      mcpConfig: this.mcpConfigFile,
    };
  }

  /**
   * The MCP config the King's CLI reads. It holds the token, so it is written readable by
   * the user only, like the token file itself.
   */
  async writeMcpConfig(): Promise<void> {
    await mkdir(this.opts.dir, { recursive: true });
    const config = {
      mcpServers: {
        guild: {
          command: process.execPath,
          args: [resolve(import.meta.dirname, 'kingMcp.ts')],
          env: { GUILD_URL: this.opts.guildUrl, GUILD_TOKEN: this.opts.token },
        },
      },
    };
    await writeFile(this.mcpConfigFile, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 });
  }

  /** Talk to the King, crowning one first if there is none yet. */
  async speak(text: string): Promise<{ id: string }> {
    if (!text.trim()) throw new ChatError(400, 'Say something to the King.');
    await this.writeMcpConfig();
    if (this.kingId && (this.opts.chats.get(this.kingId) || this.opts.sessionOf(this.kingId))) {
      await this.opts.open(this.kingId);
      this.opts.chats.send(this.kingId, text);
      return { id: this.kingId };
    }
    await mkdir(this.throneRoom, { recursive: true });
    const info = await this.opts.chats.start({
      cwd: this.throneRoom,
      name: 'King',
      message: text,
      ...this.extras(),
    });
    this.kingId = info.id;
    await writeFile(this.recordFile, JSON.stringify({ id: info.id }, null, 2) + '\n', { mode: 0o600 });
    this.opts.onChange?.();
    return { id: info.id };
  }

  // ------------------------------------------------------------------ for the King's tools

  /** Every Knight, with what the King needs to decide who gets an order. */
  knights() {
    const state = this.opts.state();
    const present = new Set(roster(state).map((h) => h.id));
    return Object.values(state.heroes)
      .filter((h) => h.parentId === null && !h.crowned)
      .sort((a, b) => b.lastActiveAt - a.lastActiveAt)
      .map((h) => this.describe(state, h, present.has(h.id)));
  }

  private describe(state: GuildState, hero: Hero, present: boolean) {
    const chat = this.opts.chats.get(hero.id);
    const party = Object.values(state.heroes).filter((m) => m.parentId === hero.id && m.status !== 'gone');
    const now = (this.opts.now?.() ?? Date.now()) / 1000;
    return {
      name: hero.name,
      id: hero.id,
      status: chat?.info.busy
        ? 'working on an order'
        : present
          ? hero.status
          : 'left the guild (can still take orders)',
      folder: this.opts.sessionOf(hero.id)?.cwd ?? null,
      branch: hero.branch,
      lastActive: `${Math.round(now - hero.lastActiveAt)}s ago`,
      quests: hero.quests.map((q) => `[${q.status}] ${q.title}`),
      party: party.map((m) => `${m.name} (${rankOf(m)}, ${m.status})`),
      looseEnds: hasLooseEnds(hero) ? hero.git : null,
      tokens: totalTokens(hero.tokens),
      commandedByYou: this.commanded.has(hero.id),
    };
  }

  /**
   * A Knight by session id or by name (any case). A Knight the guild has just started may
   * not have reached the event stream yet (transcripts are polled), so the guild's own
   * chats count too: the King can raise a Knight and order it straight away.
   */
  resolve(knight: string): { id: string; name: string } {
    const wanted = knight.trim().toLowerCase();
    const state = this.opts.state();
    const known = new Map<string, { id: string; name: string; crowned: boolean }>();
    for (const h of Object.values(state.heroes)) {
      if (h.parentId === null) known.set(h.id, { id: h.id, name: h.name, crowned: h.crowned });
    }
    for (const c of this.opts.chats.list()) {
      if (!known.has(c.id)) known.set(c.id, { id: c.id, name: c.name, crowned: false });
    }
    const candidates = [...known.values()];
    const byId = known.get(knight.trim());
    const found = byId ? [byId] : candidates.filter((h) => h.name.toLowerCase() === wanted);
    if (found.length === 0)
      throw new ChatError(404, `No Knight called "${knight}". Call list_knights to see them.`);
    if (found.length > 1) {
      throw new ChatError(
        409,
        `More than one Knight is called "${knight}": use an id (${found.map((h) => h.id).join(', ')}).`,
      );
    }
    const hero = found[0]!;
    if (hero.crowned || hero.id === this.kingId)
      throw new ChatError(400, 'The King cannot give orders to himself.');
    return { id: hero.id, name: hero.name };
  }

  async read(knight: string, last: number) {
    const hero = this.resolve(knight);
    await this.opts.open(hero.id);
    const items = this.opts.chats.get(hero.id)?.items ?? [];
    return {
      knight: hero.name,
      messages: items
        .filter((i) => i.kind === 'user' || i.kind === 'assistant' || i.kind === 'tool')
        .slice(-Math.max(1, Math.min(40, Math.floor(last) || 10)))
        .map(summarize),
    };
  }

  async command(knight: string, o: Order) {
    const hero = this.resolve(knight);
    const order = checkOrder(o.order);
    const chat = this.opts.chats.get(hero.id);
    if (chat?.info.busy) {
      throw new ChatError(
        409,
        `${hero.name} is still working on its last order. Wait, or read_knight to see how it is going.`,
      );
    }
    const lastWrite = this.opts.lastWrite(hero.id);
    const now = this.opts.now?.() ?? Date.now();
    if (!chat?.info.running && lastWrite !== null && now - lastWrite < TERMINAL_QUIET_MS) {
      throw new ChatError(
        409,
        `${hero.name} is active outside the guild right now (probably in a terminal). Do not talk over it: ask the user, or try again once it has been quiet for a minute and a half.`,
      );
    }
    await this.opts.open(hero.id);
    this.opts.chats.send(hero.id, order);
    return this.report(hero.id, hero.name, o.waitSeconds);
  }

  async raise(o: RaiseOrder) {
    const order = checkOrder(o.order);
    const name = String(o.name ?? '').trim();
    if (!name) throw new ChatError(400, 'Give the new Knight a name.');
    const info = await this.opts.chats.start({
      cwd: String(o.folder ?? ''),
      name,
      message: order,
      ...(o.mode !== undefined ? { mode: o.mode } : {}),
    });
    return this.report(info.id, info.name, o.waitSeconds);
  }

  halt(knight: string) {
    const hero = this.resolve(knight);
    if (!this.opts.chats.stop(hero.id)) throw new ChatError(404, `${hero.name} is not running anything.`);
    return { knight: hero.name, halted: true };
  }

  private async report(id: string, name: string, waitSeconds: unknown) {
    this.commanded.add(id);
    this.opts.onCommand?.(id);
    this.opts.onChange?.();
    const wait = Number(waitSeconds ?? DEFAULT_WAIT_S);
    const seconds = Number.isFinite(wait) ? Math.max(0, Math.min(MAX_WAIT_S, wait)) : DEFAULT_WAIT_S;
    const outcome: TurnOutcome = await this.opts.chats.waitForTurn(id, seconds * 1000);
    return {
      knight: name,
      id,
      finished: outcome.done,
      ok: outcome.ok,
      reply: outcome.done
        ? clip(outcome.reply, 6000) || '(no reply text)'
        : `Still working. Check later with read_knight("${name}").`,
    };
  }
}

function checkOrder(order: unknown): string {
  if (typeof order !== 'string' || !order.trim()) throw new ChatError(400, 'Write the order.');
  if (order.length > 20_000) throw new ChatError(413, 'That order is too long.');
  return order;
}

const clip = (text: string, n: number) => (text.length > n ? `${text.slice(0, n)}…` : text);

function summarize(item: ChatItem) {
  if (item.kind === 'user') return { from: 'order', text: clip(item.text, 2000) };
  if (item.kind === 'assistant') return { from: 'knight', text: clip(item.text, 2000) };
  if (item.kind === 'tool') return { from: 'tool', text: `${item.name} ${item.summary}`.trim() };
  return { from: item.kind, text: '' };
}
