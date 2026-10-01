import { describe, expect, it } from 'vitest';

import { type ChatState, applyStreamLine, emptyChat, itemsFromTranscript, toolSummary } from './chat.ts';

const fold = (lines: unknown[], start: ChatState = emptyChat()) =>
  lines.reduce<ChatState>((s, l, i) => applyStreamLine(s, l, 100 + i), start);

const delta = (text: string) => ({
  type: 'stream_event',
  event: { type: 'content_block_delta', delta: { type: 'text_delta', text } },
});

describe('applyStreamLine', () => {
  it('streams text into one assistant item, then settles it from the full message', () => {
    const s = fold([
      { type: 'system', subtype: 'init', model: 'claude-opus-5-5', session_id: 's' },
      { type: 'stream_event', event: { type: 'message_start', message: { id: 'm1' } } },
      delta('Hel'),
      delta('lo'),
    ]);
    expect(s.busy).toBe(true);
    expect(s.model).toBe('claude-opus-5-5');
    expect(s.items).toEqual([{ kind: 'assistant', id: 'm1', t: 103, text: 'Hello', streaming: true }]);

    const done = fold(
      [{ type: 'assistant', message: { id: 'm1', content: [{ type: 'text', text: 'Hello!' }] } }],
      s,
    );
    expect(done.items).toEqual([{ kind: 'assistant', id: 'm1', t: 100, text: 'Hello!', streaming: false }]);
  });

  it('shows tool calls with a one-line summary and attaches their results', () => {
    const s = fold([
      {
        type: 'assistant',
        message: {
          id: 'm1',
          content: [{ type: 'tool_use', id: 'tu1', name: 'Read', input: { file_path: '/repo/README.md' } }],
        },
      },
      {
        type: 'user',
        message: { content: [{ type: 'tool_result', tool_use_id: 'tu1', content: 'file text' }] },
      },
    ]);
    expect(s.items).toEqual([
      {
        kind: 'tool',
        id: 'tu1',
        t: 100,
        name: 'Read',
        summary: '/repo/README.md',
        result: { ok: true, preview: 'file text' },
      },
    ]);
  });

  it('marks a failed tool result', () => {
    const s = fold([
      {
        type: 'assistant',
        message: { id: 'm', content: [{ type: 'tool_use', id: 't', name: 'Bash', input: {} }] },
      },
      {
        type: 'user',
        message: {
          content: [
            {
              type: 'tool_result',
              tool_use_id: 't',
              is_error: true,
              content: [{ type: 'text', text: 'denied' }],
            },
          ],
        },
      },
    ]);
    expect(s.items[0]).toMatchObject({ result: { ok: false, preview: 'denied' } });
  });

  it('ends the turn on a result and records cost', () => {
    const s = fold([
      delta('Hi'),
      {
        type: 'result',
        subtype: 'success',
        is_error: false,
        result: 'Hi',
        total_cost_usd: 0.01,
        duration_ms: 900,
      },
    ]);
    expect(s.busy).toBe(false);
    expect(s.items.at(-1)).toMatchObject({ kind: 'result', ok: true, costUsd: 0.01, durationMs: 900 });
    expect(s.items[0]).toMatchObject({ kind: 'assistant', streaming: false });
  });

  it('turns "Not logged in" into a clear instruction instead of a reply', () => {
    const s = fold([{ type: 'result', subtype: 'success', result: 'Not logged in · Please run /login' }]);
    expect(s.loginRequired).toBe(true);
    expect(s.items.at(-1)).toMatchObject({ kind: 'notice', tone: 'error' });
  });

  it('ignores lines it does not understand', () => {
    const before = emptyChat();
    for (const line of [null, 'x', { type: 'system', subtype: 'hook_started' }, { type: 'weird' }]) {
      expect(applyStreamLine(before, line, 1)).toEqual(before);
    }
  });
});

describe('itemsFromTranscript', () => {
  it('rebuilds the conversation, skipping injected context and sub-agent turns', () => {
    const items = itemsFromTranscript([
      { type: 'user', uuid: 'u1', timestamp: '2026-09-30T12:00:00Z', message: { content: 'Fix the bug' } },
      {
        type: 'user',
        uuid: 'meta',
        isMeta: true,
        timestamp: '2026-09-30T12:00:00Z',
        message: { content: 'context' },
      },
      {
        type: 'user',
        uuid: 'cmd',
        timestamp: '2026-09-30T12:00:00Z',
        message: { content: '<command-name>/x</command-name>' },
      },
      {
        type: 'assistant',
        timestamp: '2026-09-30T12:00:01Z',
        message: {
          id: 'a1',
          content: [
            { type: 'text', text: 'Looking' },
            { type: 'tool_use', id: 't1', name: 'Grep', input: { pattern: 'bug' } },
          ],
        },
      },
      {
        type: 'user',
        timestamp: '2026-09-30T12:00:02Z',
        message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'a.ts:3' }] },
      },
      {
        type: 'assistant',
        isSidechain: true,
        timestamp: '2026-09-30T12:00:03Z',
        message: { id: 'side', content: [{ type: 'text', text: 'sub' }] },
      },
      {
        type: 'assistant',
        timestamp: '2026-09-30T12:00:04Z',
        message: { id: 'a2', content: [{ type: 'text', text: 'Fixed.' }] },
      },
    ]);
    expect(
      items.map((i) => `${i.kind}:${'text' in i ? i.text : i.kind === 'tool' ? i.summary : ''}`),
    ).toEqual(['user:Fix the bug', 'assistant:Looking', 'tool:bug', 'assistant:Fixed.']);
    expect(items[2]).toMatchObject({ result: { ok: true, preview: 'a.ts:3' } });
  });
});

describe('toolSummary', () => {
  it('picks the useful field per tool and tolerates junk', () => {
    expect(toolSummary('Bash', { command: 'npm test', description: 'Run tests' })).toBe('Run tests');
    expect(toolSummary('WebSearch', { query: 'ai news' })).toBe('ai news');
    expect(toolSummary('mcp__x__y', { url: 'https://e.x' })).toBe('https://e.x');
    expect(toolSummary('Read', null)).toBe('');
  });
});
