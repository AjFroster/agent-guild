#!/usr/bin/env node
// A stand-in for `claude -p --input-format stream-json --output-format stream-json`, used
// only by the browser tests. It speaks the same line protocol, writes a transcript where
// Claude Code would, and answers deterministically:
//
//   any message            -> "You said: <message>"
//   contains "use a tool"  -> also a Read tool call with a result
//   contains "LOGIN"       -> the CLI's not-logged-in result
//   the Town Crier prompt  -> writes <date>.md in the working folder
//
// Never shipped: the server only runs it because the test config points
// AGENT_GUILD_CLAUDE at it.

import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i === -1 ? null : args[i + 1];
};
const sessionId = flag('--session-id') ?? flag('--resume') ?? 'unknown';
const name = flag('--name');
const cwd = process.cwd();

const projects = process.env.CLAUDE_PROJECTS_DIR;
const transcript = projects ? join(projects, cwd.replace(/[^a-zA-Z0-9]/g, '-'), `${sessionId}.jsonl`) : null;
const record = (obj) => {
  if (!transcript) return;
  mkdirSync(join(transcript, '..'), { recursive: true });
  appendFileSync(
    transcript,
    JSON.stringify({ ...obj, cwd, sessionId, timestamp: new Date().toISOString() }) + '\n',
  );
};
if (name) record({ type: 'custom-title', customTitle: name });

const out = (obj) => process.stdout.write(JSON.stringify({ ...obj, session_id: sessionId }) + '\n');
let n = 0;
let initialized = false;

process.on('SIGINT', () => process.exit(130));

createInterface({ input: process.stdin }).on('line', (raw) => {
  let msg;
  try {
    msg = JSON.parse(raw);
  } catch {
    return;
  }
  const text = String(msg?.message?.content ?? '');
  record({ type: 'user', uuid: `u${n}`, message: { role: 'user', content: text } });
  if (!initialized) {
    out({ type: 'system', subtype: 'init', model: 'fake-model' });
    initialized = true;
  }

  if (text.includes('LOGIN')) {
    // The real CLI sends this as an assistant reply and then as the result.
    out({
      type: 'assistant',
      message: { id: 'login', content: [{ type: 'text', text: 'Not logged in · Please run /login' }] },
    });
    out({ type: 'result', subtype: 'success', is_error: false, result: 'Not logged in · Please run /login' });
    return;
  }

  const id = `msg_${++n}`;
  const content = [];
  if (text.includes('use a tool')) {
    const toolId = `tu_${n}`;
    const tool = { type: 'tool_use', id: toolId, name: 'Read', input: { file_path: join(cwd, 'README.md') } };
    out({ type: 'assistant', message: { id: `${id}a`, content: [tool] } });
    record({ type: 'assistant', message: { id: `${id}a`, content: [tool], stop_reason: 'tool_use' } });
    out({
      type: 'user',
      message: { content: [{ type: 'tool_result', tool_use_id: toolId, content: 'README contents' }] },
    });
  }

  let reply = `You said: ${text.slice(0, 80)}`;
  const crier = /Town Crier of an Agent Guild\. Today is (\d{4}-\d{2}-\d{2})/.exec(text);
  if (crier) {
    const date = crier[1];
    writeFileSync(
      join(cwd, `${date}.md`),
      `# Town Crier: ${date}\n\nA quiet test day.\n\n## Fake model released (8/10)\n\nA stand-in story for the browser tests.\n`,
    );
    reply = `Wrote ${date}.md`;
  }

  out({ type: 'stream_event', event: { type: 'message_start', message: { id } } });
  const half = Math.ceil(reply.length / 2);
  out({
    type: 'stream_event',
    event: { type: 'content_block_delta', delta: { type: 'text_delta', text: reply.slice(0, half) } },
  });
  out({
    type: 'stream_event',
    event: { type: 'content_block_delta', delta: { type: 'text_delta', text: reply.slice(half) } },
  });
  content.push({ type: 'text', text: reply });
  out({ type: 'assistant', message: { id, content } });
  record({ type: 'assistant', message: { id, content, stop_reason: 'end_turn' } });
  out({
    type: 'result',
    subtype: 'success',
    is_error: false,
    result: reply,
    total_cost_usd: 0,
    duration_ms: 5,
  });
});
