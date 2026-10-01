import { describe, expect, it } from 'vitest';

import { eventsFromLine, sessionName, subagentName } from './transcript.ts';

const ctx = { session: 's1' };
const at = '2026-09-30T12:00:00.000Z';
const t = Date.parse(at) / 1000;

const assistant = (content: unknown[], stop_reason: string | null = 'tool_use') => ({
  type: 'assistant',
  timestamp: at,
  message: { role: 'assistant', content, stop_reason },
});

describe('eventsFromLine', () => {
  it('turns tool calls into tool events by name only', () => {
    const line = assistant([
      { type: 'text', text: 'Let me look.' },
      { type: 'tool_use', name: 'Read', input: { file_path: '/home/someone/secret.txt' } },
      { type: 'tool_use', name: 'Bash', input: { command: 'cat ~/.ssh/id_rsa' } },
    ]);
    const events = eventsFromLine(line, ctx);
    expect(events).toEqual([
      { t, session: 's1', type: 'tool', tool: 'Read' },
      { t, session: 's1', type: 'tool', tool: 'Bash' },
    ]);
    // Nothing from the inputs or the text survives.
    expect(JSON.stringify(events)).not.toMatch(/secret|ssh|Let me look/);
  });

  it('reads TodoWrite items as quests and caps long titles', () => {
    const line = assistant([
      {
        type: 'tool_use',
        name: 'TodoWrite',
        input: {
          todos: [
            { content: 'Write the parser', status: 'completed', activeForm: 'Writing the parser' },
            { content: 'x'.repeat(200), status: 'in_progress' },
            { content: 'Bad status', status: 'blocked' },
            { status: 'pending' },
          ],
        },
      },
    ]);
    const todos = eventsFromLine(line, ctx).find((e) => e.type === 'todos');
    expect(todos).toBeDefined();
    if (todos?.type !== 'todos') return;
    expect(todos.todos.map((q) => q.status)).toEqual(['completed', 'in_progress']);
    expect(todos.todos[1]!.title).toHaveLength(120);
  });

  it('flags AskUserQuestion as the agent waiting on the user', () => {
    const events = eventsFromLine(assistant([{ type: 'tool_use', name: 'AskUserQuestion', input: {} }]), ctx);
    expect(events.map((e) => e.type)).toEqual(['tool', 'needs_input']);
  });

  it('emits stop at the end of a turn', () => {
    const events = eventsFromLine(assistant([{ type: 'text', text: 'Done.' }], 'end_turn'), ctx);
    expect(events).toEqual([{ t, session: 's1', type: 'stop' }]);
  });

  it('ignores user lines, which carry the prompts', () => {
    const line = { type: 'user', timestamp: at, message: { role: 'user', content: 'my secret plan' } };
    expect(eventsFromLine(line, ctx)).toEqual([]);
  });

  it('yields nothing for malformed lines instead of throwing', () => {
    expect(eventsFromLine(null, ctx)).toEqual([]);
    expect(eventsFromLine('text', ctx)).toEqual([]);
    expect(eventsFromLine({ type: 'assistant', message: { content: [] } }, ctx)).toEqual([]);
    expect(eventsFromLine({ type: 'assistant', timestamp: 'not a date', message: {} }, ctx)).toEqual([]);
    expect(eventsFromLine(assistant(['not a block', { type: 'tool_use' }]), ctx)).toEqual([]);
  });
});

describe('meta', () => {
  it('reports the model and git branch an assistant line ran on', () => {
    const line = {
      ...assistant([{ type: 'tool_use', name: 'Read', input: {} }]),
      gitBranch: 'feat/guild',
      message: { model: 'claude-opus-5-5', content: [], stop_reason: 'tool_use' },
    };
    expect(eventsFromLine(line, ctx)[0]).toEqual({
      t,
      session: 's1',
      type: 'meta',
      model: 'claude-opus-5-5',
      branch: 'feat/guild',
    });
  });

  it('caps a very long branch name instead of dropping the line', () => {
    const line = { ...assistant([], 'end_turn'), gitBranch: 'b'.repeat(300) };
    const meta = eventsFromLine(line, ctx).find((e) => e.type === 'meta');
    expect(meta?.type === 'meta' && meta.branch).toHaveLength(100);
  });
});

describe('names', () => {
  it('names a session after its project folder', () => {
    expect(sessionName('/home/someone/Sandbox/movie-league', 'x')).toBe('movie-league');
    expect(sessionName('C:\\work\\guild\\', 'x')).toBe('guild');
    expect(sessionName(undefined, 'Session')).toBe('Session');
  });

  it('names a sub-agent after its type, then its description', () => {
    expect(subagentName({ agentType: 'Explore', description: 'Find files' }, 'Helper')).toBe('Explore');
    expect(subagentName({ description: 'Find files' }, 'Helper')).toBe('Find files');
    expect(subagentName(null, 'Helper')).toBe('Helper');
  });
});

describe('token usage', () => {
  const reply = (id: string, usage: Record<string, number>, content: unknown[] = []) => ({
    type: 'assistant',
    timestamp: at,
    message: { id, role: 'assistant', content, stop_reason: null, usage },
  });
  const usageOf = (events: ReturnType<typeof eventsFromLine>) => events.filter((e) => e.type === 'usage');

  it('reads the four counts and nothing else', () => {
    const events = eventsFromLine(
      reply('m1', {
        input_tokens: 12,
        output_tokens: 340,
        cache_read_input_tokens: 9000,
        cache_creation_input_tokens: 500,
      }),
      { session: 's1', usage: new Map() },
    );
    expect(usageOf(events)).toEqual([
      { t, session: 's1', type: 'usage', input: 12, output: 340, cacheRead: 9000, cacheWrite: 500 },
    ]);
  });

  it('counts a reply split over several lines once, and only what grew', () => {
    const usage = new Map();
    const u = { input_tokens: 10, output_tokens: 50 };
    const first = eventsFromLine(reply('m1', u, [{ type: 'text', text: 'a' }]), { session: 's1', usage });
    const again = eventsFromLine(reply('m1', u, [{ type: 'tool_use', name: 'Read' }]), {
      session: 's1',
      usage,
    });
    const grew = eventsFromLine(reply('m1', { ...u, output_tokens: 80 }), { session: 's1', usage });
    const next = eventsFromLine(reply('m2', u), { session: 's1', usage });
    expect(usageOf(first)).toHaveLength(1);
    expect(usageOf(again)).toEqual([]);
    expect(usageOf(grew)).toMatchObject([{ input: 0, output: 30 }]);
    expect(usageOf(next)).toMatchObject([{ input: 10, output: 50 }]);
  });

  it('ignores usage numbers that are missing, negative or not numbers', () => {
    const events = eventsFromLine(
      reply('m1', { input_tokens: -5, output_tokens: Number.NaN, cache_read_input_tokens: 'x' as never }),
      { session: 's1', usage: new Map() },
    );
    expect(usageOf(events)).toEqual([]);
  });
});
