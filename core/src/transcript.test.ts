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
