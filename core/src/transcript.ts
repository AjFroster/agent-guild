import type { GuildEvent, Todo, TodoStatus } from './events.ts';

/**
 * Turns Claude Code transcript lines (`~/.claude/projects/<project>/<session>.jsonl`) into
 * guild events.
 *
 * Only structure crosses this boundary: tool names, todo titles, turn ends, and a
 * sub-agent's short description. Prompt text, tool inputs, file contents and replies are
 * read past and dropped here, so nothing downstream can leak them.
 *
 * The transcript format is Claude Code's internal format, not a public contract. Every
 * field is read defensively and a line that does not look as expected yields no events.
 */

export interface TranscriptContext {
  /** Guild id for this transcript: the session id, or `agent-…` for a sub-agent file. */
  session: string;
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

/** Events from one parsed transcript line. */
export function eventsFromLine(line: unknown, ctx: TranscriptContext): GuildEvent[] {
  if (!isObject(line)) return [];
  const t = lineTime(line);
  if (t === null) return [];
  const session = ctx.session;

  if (line.type === 'assistant' && isObject(line.message)) {
    const events: GuildEvent[] = [];
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
