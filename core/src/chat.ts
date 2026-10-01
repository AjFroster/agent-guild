/**
 * The chat view of a Claude Code session: what you said, what Claude said, and the tools
 * it ran, in order.
 *
 * Unlike guild events (events.ts), chat items carry real conversation content. They are
 * only ever served to a browser holding the token, over loopback, and only for the chat
 * the user opened. Two sources produce them, both handled here as pure functions:
 *
 *   - `applyStreamLine`: one line of `claude -p --output-format stream-json` output, for a
 *     session the guild is running right now.
 *   - `itemsFromTranscript`: the session's saved transcript, for history.
 */

export type ChatItem =
  | { kind: 'user'; id: string; t: number; text: string }
  | { kind: 'assistant'; id: string; t: number; text: string; streaming: boolean }
  | {
      kind: 'tool';
      id: string;
      t: number;
      name: string;
      /** One line saying what the call was about: a path, a command, a query. */
      summary: string;
      result: { ok: boolean; preview: string } | null;
    }
  | {
      kind: 'result';
      id: string;
      t: number;
      ok: boolean;
      text: string;
      costUsd: number | null;
      durationMs: number | null;
    }
  | { kind: 'notice'; id: string; t: number; text: string; tone: 'info' | 'error' };

export interface ChatState {
  items: ChatItem[];
  /** A turn is in progress. */
  busy: boolean;
  /** The CLI answered "Not logged in". */
  loginRequired: boolean;
  model: string | null;
  /** Id of the assistant message currently streaming, for attaching text deltas. */
  currentMessage: string | null;
}

export const emptyChat = (): ChatState => ({
  items: [],
  busy: false,
  loginRequired: false,
  model: null,
  currentMessage: null,
});

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

const PREVIEW = 600;
const clip = (s: string, n = PREVIEW) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** A one-line description of a tool call, from its input. */
export function toolSummary(name: string, input: unknown): string {
  if (!isObject(input)) return '';
  const pick = (...keys: string[]) => keys.map((k) => str(input[k])).find(Boolean) ?? '';
  switch (name) {
    case 'Read':
    case 'Write':
    case 'Edit':
    case 'MultiEdit':
    case 'NotebookEdit':
      return pick('file_path', 'notebook_path');
    case 'Bash':
      return clip(pick('description', 'command'), 160);
    case 'Grep':
    case 'Glob':
      return pick('pattern');
    case 'WebSearch':
      return pick('query');
    case 'WebFetch':
      return pick('url');
    case 'Agent':
    case 'Task':
      return pick('description');
    default:
      return clip(pick('description', 'query', 'path', 'url', 'command'), 160);
  }
}

function resultText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((b) => (isObject(b) && b.type === 'text' ? str(b.text) : ''))
      .filter(Boolean)
      .join('\n');
  }
  return '';
}

function upsert(items: ChatItem[], item: ChatItem): ChatItem[] {
  const i = items.findIndex((x) => x.id === item.id);
  if (i === -1) return [...items, item];
  const next = items.slice();
  next[i] = item;
  return next;
}

/** Attach tool results carried by a user-role message to their tool items. */
function withToolResults(items: ChatItem[], content: unknown): ChatItem[] {
  if (!Array.isArray(content)) return items;
  let next = items;
  for (const block of content) {
    if (!isObject(block) || block.type !== 'tool_result') continue;
    const id = str(block.tool_use_id);
    const tool = next.find((x) => x.kind === 'tool' && x.id === id);
    if (tool?.kind !== 'tool') continue;
    next = upsert(next, {
      ...tool,
      result: { ok: block.is_error !== true, preview: clip(resultText(block.content)) },
    });
  }
  return next;
}

/** Add the text and tool calls of one complete assistant message. */
function withAssistant(items: ChatItem[], message: Json, t: number): ChatItem[] {
  const msgId = str(message.id) || `a-${t}`;
  const content = Array.isArray(message.content) ? message.content : [];
  const text = content
    .map((b) => (isObject(b) && b.type === 'text' ? str(b.text) : ''))
    .filter(Boolean)
    .join('\n\n');
  let next = items;
  if (text) next = upsert(next, { kind: 'assistant', id: msgId, t, text, streaming: false });
  else next = next.filter((x) => !(x.kind === 'assistant' && x.id === msgId && x.streaming));
  for (const b of content) {
    if (!isObject(b) || b.type !== 'tool_use') continue;
    const id = str(b.id);
    if (!id || next.some((x) => x.id === id)) continue;
    next = [
      ...next,
      { kind: 'tool', id, t, name: str(b.name), summary: toolSummary(str(b.name), b.input), result: null },
    ];
  }
  return next;
}

const LOGIN = /not logged in|please run \/login/i;

/** Fold one parsed line of stream-json output into the chat. */
export function applyStreamLine(state: ChatState, line: unknown, now: number): ChatState {
  if (!isObject(line)) return state;

  switch (line.type) {
    case 'system':
      if (line.subtype === 'init') return { ...state, busy: true, model: str(line.model) || state.model };
      return state;

    case 'stream_event': {
      const event = line.event;
      if (!isObject(event)) return state;
      if (event.type === 'message_start' && isObject(event.message)) {
        return { ...state, currentMessage: str(event.message.id) || null };
      }
      const delta = event.delta;
      if (event.type === 'content_block_delta' && isObject(delta) && delta.type === 'text_delta') {
        const id = state.currentMessage ?? `stream-${now}`;
        const existing = state.items.find((x) => x.id === id);
        const text = (existing?.kind === 'assistant' ? existing.text : '') + str(delta.text);
        return {
          ...state,
          busy: true,
          items: upsert(state.items, { kind: 'assistant', id, t: now, text, streaming: true }),
        };
      }
      return state;
    }

    case 'assistant':
      if (!isObject(line.message)) return state;
      return { ...state, busy: true, items: withAssistant(state.items, line.message, now) };

    case 'user':
      if (!isObject(line.message)) return state;
      return { ...state, items: withToolResults(state.items, line.message.content) };

    case 'result': {
      const text = str(line.result);
      const ok = line.is_error !== true && line.subtype === 'success';
      const loginRequired = LOGIN.test(text);
      const items = state.items.map((x) =>
        x.kind === 'assistant' && x.streaming ? { ...x, streaming: false } : x,
      );
      const summary: ChatItem = loginRequired
        ? {
            kind: 'notice',
            id: `result-${now}`,
            t: now,
            tone: 'error',
            text: 'Claude Code is not logged in on this machine. In a WSL terminal, run `claude` and then `/login`, then send your message again.',
          }
        : {
            kind: 'result',
            id: `result-${str(line.uuid) || now}`,
            t: now,
            ok,
            text: ok ? '' : text,
            costUsd: typeof line.total_cost_usd === 'number' ? line.total_cost_usd : null,
            durationMs: typeof line.duration_ms === 'number' ? line.duration_ms : null,
          };
      return {
        ...state,
        busy: false,
        loginRequired: loginRequired || state.loginRequired,
        items: [...items, summary],
      };
    }

    default:
      return state;
  }
}

/** Rebuild a chat from a saved transcript (`~/.claude/projects/<p>/<session>.jsonl`). */
export function itemsFromTranscript(lines: unknown[]): ChatItem[] {
  let items: ChatItem[] = [];
  for (const line of lines) {
    if (!isObject(line) || !isObject(line.message)) continue;
    // Sub-agent turns and Claude Code's own injected context are not part of the chat.
    if (line.isSidechain === true || line.isMeta === true) continue;
    const t = typeof line.timestamp === 'string' ? Date.parse(line.timestamp) / 1000 || 0 : 0;
    const message = line.message;

    if (line.type === 'assistant') {
      items = withAssistant(items, message, t);
    } else if (line.type === 'user') {
      const content = message.content;
      if (typeof content === 'string') {
        if (content.trim() && !content.startsWith('<')) {
          items.push({ kind: 'user', id: str(line.uuid) || `u-${t}`, t, text: content });
        }
      } else if (Array.isArray(content)) {
        const text = content
          .map((b) => (isObject(b) && b.type === 'text' ? str(b.text) : ''))
          .filter((s) => s && !s.startsWith('<'))
          .join('\n\n');
        if (text) items.push({ kind: 'user', id: str(line.uuid) || `u-${t}`, t, text });
        items = withToolResults(items, content);
      }
    }
  }
  return items;
}
