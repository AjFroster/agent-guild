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
// Started with --mcp-config it plays the King: it starts the MCP servers in that config
// (the guild's real one) and calls real tools, so a test covers the whole chain:
//
//   "order <Knight>: <text>"           -> command_knight, replies with the Knight's answer
//   "raise <Name> in <folder>: <text>" -> raise_knight
//   anything else                      -> list_knights, replies with their names
//
// and the librarians, chosen by their prompt:
//
//   the Scout Librarian     -> add_candidate for the test skill in FAKE_SKILL_REPO
//   the Reviewing Librarian -> record_review ("gap") for every candidate
//   "consult the archive"   -> (as the King) consult_archive, replies with installed names
//
// Never shipped: the server only runs it because the test config points
// AGENT_GUILD_CLAUDE at it.

import { execFileSync, spawn } from 'node:child_process';
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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

/** The King's MCP connection: one JSON-RPC client over the server's stdio. */
const mcpConfig = flag('--mcp-config');
/** Which guild role the MCP config gives this session: king, knight, smith, ... */
const role = mcpConfig
  ? (Object.values(JSON.parse(readFileSync(mcpConfig, 'utf8')).mcpServers)[0]?.env?.GUILD_ROLE ?? 'king')
  : null;
let mcp = null;
function connectMcp() {
  const [server] = Object.values(JSON.parse(readFileSync(mcpConfig, 'utf8')).mcpServers);
  const child = spawn(server.command, server.args, { env: { ...process.env, ...server.env } });
  const waiting = new Map();
  let buffer = '';
  let next = 0;
  child.stdout.on('data', (d) => {
    buffer += d.toString('utf8');
    for (let i = buffer.indexOf('\n'); i !== -1; i = buffer.indexOf('\n')) {
      const msg = JSON.parse(buffer.slice(0, i));
      buffer = buffer.slice(i + 1);
      waiting.get(msg.id)?.(msg);
    }
  });
  const request = (method, params) =>
    new Promise((resolve) => {
      const id = ++next;
      waiting.set(id, resolve);
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  const ready = request('initialize', { protocolVersion: '2025-06-18', capabilities: {} });
  return {
    async call(name, args) {
      await ready;
      const answer = await request('tools/call', { name, arguments: args });
      return answer.result?.content?.[0]?.text ?? JSON.stringify(answer.error);
    },
  };
}

/** One King tool call, shown and recorded like the real CLI does, then its result. */
async function kingTool(name, args) {
  mcp ??= connectMcp();
  const toolId = `tu_${++n}`;
  const tool = { type: 'tool_use', id: toolId, name: `mcp__guild__${name}`, input: args };
  out({ type: 'assistant', message: { id: `k${toolId}`, content: [tool] } });
  record({ type: 'assistant', message: { id: `k${toolId}`, content: [tool], stop_reason: 'tool_use' } });
  const text = await mcp.call(name, args);
  out({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: toolId, content: text }] } });
  return text;
}
let n = 0;
let initialized = false;

process.on('SIGINT', () => process.exit(130));
// One line, so the guild's "exited with code 1" notice shows the actual error.
process.on('uncaughtException', (err) => {
  process.stderr.write(`fake-claude crashed: ${String(err?.stack ?? err).replace(/\n\s*/g, ' | ')}\n`);
  process.exit(1);
});

createInterface({ input: process.stdin }).on('line', (raw) => void answer(raw));

async function answer(raw) {
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
  if (mcpConfig) {
    const order = /^order (\S+): (.+)$/s.exec(text);
    const raise = /^raise (\S+) in (\S+): (.+)$/s.exec(text);
    // A refusal comes back as plain text, which the King reads out as a model would.
    const parse = (answer) => {
      try {
        return JSON.parse(answer);
      } catch {
        return { refused: answer };
      }
    };
    const forgeMe = /^forge me a (skill|command): (.+)$/s.exec(text);
    if (role === 'knight') {
      // A Knight that keeps needing something asks the Forge for it; otherwise it just talks.
      if (forgeMe) {
        const answer = parse(await kingTool('request_equipment', { kind: forgeMe[1], need: forgeMe[2] }));
        reply = answer.refused
          ? `The Forge refused: ${answer.refused}`
          : `Asked the Forge (order ${answer.id}).`;
      }
    } else if (text.includes('You are the Blacksmith')) {
      const order = parse(await kingTool('read_order', {}));
      // First the Library: a skill the user has, named in the order, is used instead.
      const { installed } = parse(await kingTool('list_installed_skills', {}));
      await kingTool('list_archive', {});
      const have = installed.find((sk) => order.need.includes(sk.name));
      if (order.need.includes('impossible')) {
        // Lets a test make a run fail: the Blacksmith hangs nothing on the rack.
        reply = 'That cannot be forged.';
      } else if (have) {
        await kingTool('already_exists', {
          id: order.id,
          name: have.name,
          where: have.source,
          reason: `${have.name} already does this.`,
        });
        reply = `Already in the Library: ${have.name}.`;
      } else {
        // A command is one <name>.md; a skill is SKILL.md plus anything else it needs.
        const name = order.kind === 'command' ? 'hello' : 'release-notes';
        const result = parse(
          await kingTool('submit_piece', {
            id: order.id,
            name,
            description:
              order.kind === 'command'
                ? 'Say hello and what this project is.'
                : 'Write release notes the way this project does.',
            files:
              order.kind === 'command'
                ? [
                    {
                      path: `${name}.md`,
                      content: 'Say hello, then say what this project is in one sentence.\n',
                    },
                  ]
                : [
                    {
                      path: 'SKILL.md',
                      content: `---\nname: ${name}\ndescription: Write release notes the way this project does.\n---\n\n# Release notes\n\n1. Run scripts/changes.sh <last tag>.\n2. Group the changes under Added, Fixed and Changed.\n`,
                    },
                    { path: 'scripts/changes.sh', content: '#!/bin/sh\ngit log --oneline "$1"..HEAD\n' },
                  ],
          }),
        );
        reply = result.refused ? `Refused: ${result.refused}` : `Forged ${name}.`;
      }
    } else if (text.includes('The Forge has a piece waiting for review')) {
      const { pieces } = parse(await kingTool('list_forged', {}));
      for (const p of pieces) {
        await kingTool('review_piece', {
          id: p.id,
          verdict: 'ready',
          reason: 'Does what was asked, from the project itself; the script only reads git history.',
          risks: [],
        });
      }
      reply = `Reviewed ${pieces.length} piece(s) from the Forge.`;
    } else if (text.includes('You are the Scout Librarian')) {
      const commit = execFileSync('git', ['--git-dir', process.env.FAKE_SKILL_REPO, 'rev-parse', 'HEAD'])
        .toString()
        .trim();
      const { known } = parse(await kingTool('list_archive', {}));
      // A later run finds the repository's second skill, as a real Scout would.
      if (known.some((k) => k.name === 'csv-wrangler')) {
        await kingTool('add_candidate', {
          name: 'md-tables',
          repo: 'acme-labs/agent-skills',
          path: 'skills/md-tables',
          commit,
          stars: 6400,
          description: 'Format Markdown tables.',
        });
        await kingTool('write_note', { text: 'Looked again; added md-tables.' });
        reply = 'Added 1 candidate.';
      } else {
        // Below the user's star threshold: the Archive must refuse it.
        const small = await kingTool('add_candidate', {
          name: 'tiny-helper',
          repo: 'acme-labs/tiny-helper',
          path: '',
          commit: commit,
          stars: 340,
        });
        await kingTool('add_candidate', {
          name: 'csv-wrangler',
          repo: 'acme-labs/agent-skills',
          path: 'skills/csv-wrangler',
          commit,
          stars: 6400,
          description: 'Clean, join and summarise CSV files.',
        });
        const refused = parse(small).refused ? ' tiny-helper had too few stars.' : ' tiny-helper got in!';
        await kingTool('write_note', { text: `Looked at 12 skills; added csv-wrangler.${refused}` });
        reply = 'Added 1 candidate.';
      }
    } else if (text.includes('You are the Reviewing Librarian')) {
      const { candidates } = parse(await kingTool('list_candidates', {}));
      for (const c of candidates) {
        await kingTool('record_review', {
          id: c.id,
          verdict: 'gap',
          reason:
            c.name === 'csv-wrangler'
              ? 'Nothing installed handles plain CSV files.'
              : 'Nothing installed formats Markdown tables.',
          overlaps: [],
          risks: [],
        });
      }
      await kingTool('write_note', {
        text: `Reviewed ${candidates.length}; ${candidates.map((c) => c.name).join(', ')} fills a gap.`,
      });
      reply = `Reviewed ${candidates.length}.`;
    } else if (text.includes('consult the archive')) {
      const result = parse(await kingTool('consult_archive', {}));
      reply = `Installed skills: ${result.installed.map((s) => s.name).join(', ')}.`;
    } else if (order) {
      const result = parse(
        await kingTool('command_knight', { knight: order[1], order: order[2], wait_seconds: 30 }),
      );
      reply = result.refused ? `Refused: ${result.refused}` : `${result.knight} reports: ${result.reply}`;
    } else if (raise) {
      const result = parse(
        await kingTool('raise_knight', {
          name: raise[1],
          folder: raise[2],
          order: raise[3],
          wait_seconds: 30,
        }),
      );
      reply = result.refused
        ? `Refused: ${result.refused}`
        : `I raised ${result.knight}. It reports: ${result.reply}`;
    } else {
      const result = parse(await kingTool('list_knights', {}));
      reply = result.refused
        ? `Refused: ${result.refused}`
        : `The kingdom has ${result.knights.length} Knights: ${result.knights.map((k) => k.name).join(', ')}.`;
    }
  }
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
}
