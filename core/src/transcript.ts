import type { GuildEvent, Todo, TodoStatus } from './events.ts';
import type { Tokens } from './game.ts';

/**
 * Turns Claude Code transcript lines (`~/.claude/projects/<project>/<session>.jsonl`) into
 * guild events.
 *
 * Only structure crosses this boundary: tool names, todo titles, turn ends, the model
 * and git branch, token counts, and a sub-agent's short description. Prompt text, tool inputs, file contents and replies are
 * read past and dropped here, so nothing downstream can leak them.
 *
 * The transcript format is Claude Code's internal format, not a public contract. Every
 * field is read defensively and a line that does not look as expected yields no events.
 */

export interface TranscriptContext {
  /** Guild id for this transcript: the session id, or `agent-…` for a sub-agent file. */
  session: string;
  /**
   * Usage already counted, per message id. Claude Code writes one line per content block
   * of a reply and repeats the reply's usage on each, so without this a reply with three
   * tool calls would count three times. Keep one per transcript file.
   */
  usage?: Map<string, Tokens>;
}

type Json = Record<string, unknown>;

const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Epoch seconds from the line's ISO timestamp, or null when missing or unparseable. */
export function lineTime(line: Json): number | null {
  if (typeof line.timestamp !== 'string') return null;
  const ms = Date.parse(line.timestamp);
  return Number.isNaN(ms) ? null : ms / 1000;
}

const TODO_STATUSES: readonly TodoStatus[] = ['pending', 'in_progress', 'completed'];

function todosFrom(input: unknown): Todo[] | null {
  if (!isObject(input) || !Array.isArray(input.todos)) return null;
  const todos: Todo[] = [];
  input.todos.forEach((raw, i) => {
    if (!isObject(raw)) return;
    const title = typeof raw.content === 'string' ? raw.content.trim() : '';
    const status = TODO_STATUSES.find((s) => s === raw.status);
    if (!title || !status) return;
    const id = typeof raw.id === 'string' && raw.id ? raw.id : String(i + 1);
    todos.push({ id, title: title.length > 120 ? `${title.slice(0, 119)}…` : title, status });
  });
  return todos.slice(0, 50);
}

const count = (v: unknown): number =>
  typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;

/** Bound on remembered message ids; replies arrive in order, so recent ones suffice. */
const USAGE_MEMORY = 200;

/**
 * The tokens a line adds: its reply's usage minus what earlier lines of the same reply
 * already counted. Null when nothing new.
 */
function usageDelta(message: Json, memory: Map<string, Tokens> | undefined): Tokens | null {
  const u = message.usage;
  if (!isObject(u)) return null;
  const now: Tokens = {
    input: count(u.input_tokens),
    output: count(u.output_tokens),
    cacheRead: count(u.cache_read_input_tokens),
    cacheWrite: count(u.cache_creation_input_tokens),
  };
  const id = typeof message.id === 'string' ? message.id : null;
  const before = (id && memory?.get(id)) || { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  if (id && memory) {
    memory.delete(id);
    memory.set(id, now);
    if (memory.size > USAGE_MEMORY) memory.delete(memory.keys().next().value!);
  }
  const delta: Tokens = {
    input: Math.max(0, now.input - before.input),
    output: Math.max(0, now.output - before.output),
    cacheRead: Math.max(0, now.cacheRead - before.cacheRead),
    cacheWrite: Math.max(0, now.cacheWrite - before.cacheWrite),
  };
  return delta.input + delta.output + delta.cacheRead + delta.cacheWrite > 0 ? delta : null;
}

/** Events from one parsed transcript line. */
export function eventsFromLine(line: unknown, ctx: TranscriptContext): GuildEvent[] {
  if (!isObject(line)) return [];
  const t = lineTime(line);
  if (t === null) return [];
  const session = ctx.session;

  if (line.type === 'assistant' && isObject(line.message)) {
    const events: GuildEvent[] = [];
    const model = typeof line.message.model === 'string' ? line.message.model.slice(0, 60) : '';
    const branch = typeof line.gitBranch === 'string' ? line.gitBranch.slice(0, 100) : '';
    if (model || branch) {
      events.push({
        t,
        session,
        type: 'meta',
        ...(model ? { model } : {}),
        ...(branch ? { branch } : {}),
      });
    }
    const tokens = usageDelta(line.message, ctx.usage);
    if (tokens) events.push({ t, session, type: 'usage', ...tokens });
    const content = Array.isArray(line.message.content) ? line.message.content : [];
    for (const block of content) {
      if (!isObject(block) || block.type !== 'tool_use' || typeof block.name !== 'string') continue;
      events.push({ t, session, type: 'tool', tool: block.name });
      if (block.name === 'TodoWrite') {
        const todos = todosFrom(block.input);
        if (todos) events.push({ t, session, type: 'todos', todos });
      }
      // Claude is asking the user a question and will wait for the answer.
      if (block.name === 'AskUserQuestion') events.push({ t, session, type: 'needs_input' });
    }
    if (line.message.stop_reason === 'end_turn') events.push({ t, session, type: 'stop' });
    return events;
  }

  return [];
}

/** A readable hero name for a main session: the project folder it runs in. */
export function sessionName(cwd: unknown, fallback: string): string {
  const base = typeof cwd === 'string' ? cwd.split(/[\\/]/).filter(Boolean).pop() : undefined;
  return (base || fallback).slice(0, 40);
}

/** A readable party-member name from a sub-agent's `.meta.json`. */
export function subagentName(meta: unknown, fallback: string): string {
  if (isObject(meta)) {
    for (const key of ['agentType', 'description'] as const) {
      const v = meta[key];
      if (typeof v === 'string' && v.trim()) return v.trim().slice(0, 40);
    }
  }
  return fallback.slice(0, 40);
}
