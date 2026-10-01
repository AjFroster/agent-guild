#!/usr/bin/env node
/**
 * The dress rehearsal (docs/SHARPEN.md, phase A): does the guild work with the real
 * `claude`, not only the stand-in its tests use?
 *
 *   npm run rehearse              preflight only: free, offline, no usage
 *   npm run rehearse -- --live    then each utility once, for real (uses your Claude usage)
 *
 * The preflight checks every flag and permission mode the guild passes the CLI, and starts
 * each of the guild's MCP roles to list its tools. The live run starts a throwaway guild
 * (its own port, data folder and project folder inside your home), commissions one tiny
 * slash command from the Forge, asks the King one question, and runs the librarians for one
 * skill. It installs nothing, and prints a report: each step, passed or failed, its time
 * and the tokens it spent. Never run by CI or by tests.
 */
import { execFile, spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { promisify } from 'node:util';

const exec = promisify(execFile);
/** A CLI call with a time limit: a CLI that waits for input must not hang the rehearsal. */
const run = (cmd: string, args: string[], opts: { maxBuffer?: number } = {}) =>
  exec(cmd, args, { timeout: 20_000, ...opts });
const ROOT = resolve(import.meta.dirname, '..');
const CLAUDE = process.env.AGENT_GUILD_CLAUDE ?? 'claude';
const live = process.argv.includes('--live');

interface Step {
  name: string;
  ok: boolean;
  detail: string;
  ms: number;
  tokens?: number;
}
const steps: Step[] = [];

async function step(name: string, fn: () => Promise<string | { detail: string; tokens?: number }>) {
  const start = Date.now();
  try {
    const out = await fn();
    const r = typeof out === 'string' ? { detail: out } : out;
    steps.push({ name, ok: true, ms: Date.now() - start, ...r });
  } catch (err) {
    steps.push({ name, ok: false, detail: (err as Error).message.split('\n')[0]!, ms: Date.now() - start });
  }
  const s = steps.at(-1)!;
  console.log(`${s.ok ? '✔' : '✘'} ${s.name}: ${s.detail}`);
}

// ------------------------------------------------------------------ preflight (free)

/** Modes the guild starts sessions in (chats.ts CHAT_MODES, and the helpers' 'default'). */
const MODES = ['acceptEdits', 'plan', 'auto', 'default', 'bypassPermissions'];
/** Flags chats.ts passes on every turn. */
const FLAGS = [
  '-p',
  '--input-format',
  '--output-format',
  '--verbose',
  '--include-partial-messages',
  '--permission-mode',
  '--session-id',
  '--name',
  '--resume',
  '--allowedTools',
  '--append-system-prompt',
  '--mcp-config',
];
/** Each MCP role, and tools it must offer. */
const ROLES: Record<string, string[]> = {
  king: ['list_knights', 'command_knight', 'raise_knight', 'consult_archive', 'commission_equipment'],
  scout: ['list_installed_skills', 'list_archive', 'add_candidate', 'write_note'],
  reviewer: ['list_installed_skills', 'list_candidates', 'record_review', 'write_note'],
  knight: ['request_equipment', 'check_equipment'],
  smith: ['read_order', 'submit_piece'],
  'forge-reviewer': ['list_forged', 'review_piece'],
};

async function preflight() {
  await step('the claude CLI', async () => (await run(CLAUDE, ['--version'])).stdout.trim());
  await step('its flags', async () => {
    const help = (await run(CLAUDE, ['--help'], { maxBuffer: 4_000_000 })).stdout;
    const missing = FLAGS.filter((f) => !new RegExp(`(^|[\\s,])${f}[\\s,=<]`, 'm').test(help));
    if (missing.length) throw new Error(`missing: ${missing.join(' ')}`);
    return `all ${FLAGS.length} the guild uses are there`;
  });
  await step('its permission modes', async () => {
    // Options are checked before anything is sent, so this spends nothing.
    const refused: string[] = [];
    for (const mode of MODES)
      await run(CLAUDE, ['--permission-mode', mode, '--version']).catch(() => refused.push(mode));
    if (refused.length) throw new Error(`refused: ${refused.join(', ')}`);
    return `all ${MODES.length} accepted`;
  });
  for (const [role, tools] of Object.entries(ROLES))
    await step(`the "${role}" MCP role`, async () => {
      const listed = await mcpTools(role);
      const missing = tools.filter((t) => !listed.includes(t));
      if (missing.length) throw new Error(`missing tools: ${missing.join(', ')}`);
      return `${listed.length} tools`;
    });
}

/** Start the guild's MCP server in a role and list its tools, as the CLI would. */
function mcpTools(role: string): Promise<string[]> {
  return new Promise((done, fail) => {
    const child = spawn(process.execPath, [join(ROOT, 'server/src/kingMcp.ts')], {
      env: {
        ...process.env,
        GUILD_URL: 'http://127.0.0.1:9',
        GUILD_TOKEN: 'rehearsal-token-000000',
        GUILD_ROLE: role,
      },
    });
    const timer = setTimeout(() => {
      child.kill();
      fail(new Error('no answer in 10 s'));
    }, 10_000);
    child.on('error', fail);
    createInterface({ input: child.stdout }).on('line', (line) => {
      const msg = JSON.parse(line) as { id: number; result?: { tools?: { name: string }[] } };
      if (msg.id === 2) {
        clearTimeout(timer);
        child.kill();
        done((msg.result?.tools ?? []).map((t) => t.name));
      }
    });
    const send = (m: object) => child.stdin.write(JSON.stringify(m) + '\n');
    send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } });
    send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
  });
}

// ------------------------------------------------------------------ the live run (usage)

async function liveRun() {
  const port = 4800 + Math.floor(Math.random() * 100);
  const token = `rehearsal-${Math.random().toString(36).slice(2)}-token`;
  const scratch = await mkdtemp(join(homedir(), '.agent-guild-rehearsal-'));
  const project = join(scratch, 'bakery');
  const data = join(scratch, 'data');
  await run('mkdir', ['-p', project, data]);
  await writeFile(
    join(project, 'README.md'),
    '# Bakery\n\nA tiny pretend shop. Run `npm test` to test it.\n',
  );
  await writeFile(join(data, 'town-crier.json'), '{"enabled":false}');
  const server = spawn(process.execPath, [join(ROOT, 'server/src/cli.ts')], {
    env: {
      ...process.env,
      AGENT_GUILD_PORT: String(port),
      AGENT_GUILD_TOKEN: token,
      AGENT_GUILD_DATA_DIR: data,
      AGENT_GUILD_HOME: scratch,
      CLAUDE_PROJECTS_DIR: join(homedir(), '.claude', 'projects'),
      AGENT_GUILD_GIT: '0',
      AGENT_GUILD_PORTALS: '0',
    },
    stdio: 'ignore',
  });
  const base = `http://127.0.0.1:${port}`;
  const call = async (method: string, path: string, body?: unknown) => {
    const res = await fetch(base + path, {
      method,
      headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) throw new Error(String(data.error ?? res.status));
    return data;
  };
  const until = async <T>(what: string, check: () => Promise<T | null>, minutes: number): Promise<T> => {
    const end = Date.now() + minutes * 60_000;
    while (Date.now() < end) {
      const v = await check().catch(() => null);
      if (v) return v;
      await new Promise((r) => setTimeout(r, 2000));
    }
    throw new Error(`${what}: not done after ${minutes} min`);
  };
  /** The first message of one of the guild's event streams: its snapshot. */
  const snapshot = async (path: string): Promise<unknown> => {
    const res = await fetch(`${base}${path}?token=${token}`);
    if (!res.ok || !res.body) throw new Error(`${path}: ${res.status}`);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let text = '';
    while (!text.includes('\n\n')) {
      const { value, done } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
    }
    void reader.cancel();
    const data = text
      .split('\n\n')[0]!
      .split('\n')
      .filter((l) => l.startsWith('data: '))
      .map((l) => l.slice(6))
      .join('\n');
    return JSON.parse(data);
  };
  /** Tokens the guild has seen sessions use, from its own event stream. */
  const tokensBy = async (names: string[]) => {
    const events = (await snapshot('/api/events')) as {
      session: string;
      type: string;
      name?: string;
      input?: number;
      output?: number;
    }[];
    const ids = new Set(
      events.filter((e) => e.type === 'session_start' && names.includes(e.name ?? '')).map((e) => e.session),
    );
    return events
      .filter((e) => e.type === 'usage' && ids.has(e.session))
      .reduce((n, e) => n + (e.input ?? 0) + (e.output ?? 0), 0);
  };

  try {
    await step('a throwaway guild starts', () =>
      until('health', async () => ((await call('GET', '/api/health')).ok ? `on port ${port}` : null), 1),
    );
    await step('the Forge forges a slash command and the Library reviews it', async () => {
      const { id } = await call('POST', '/api/forge/orders', {
        project,
        kind: 'command',
        need: 'A slash command named hello that tells the user hello and what this project is, in one sentence.',
      });
      const order = await until(
        'the order',
        async () => {
          const { orders } = (await call('GET', '/api/forge')) as {
            orders: { id: string; status: string }[];
          };
          const o = orders.find((x) => x.id === id);
          if (o?.status === 'failed') throw new Error('failed');
          return o && o.status === 'reviewed' ? o : null;
        },
        15,
      );
      const full = order as unknown as { piece: { name: string }; review: { verdict: string } };
      return {
        detail: `forged "${full.piece.name}", the Library says ${full.review.verdict} (not installed)`,
        tokens: await tokensBy(['Blacksmith', 'Reviewer']),
      };
    });
    await step('the King answers', async () => {
      const { id } = (await call('POST', '/api/king/messages', {
        text: 'Rehearsal: list the Knights in one short sentence.',
      })) as {
        id: string;
      };
      await until(
        'the King',
        async () => {
          const chat = (await snapshot(`/api/chats/${id}/stream`)) as {
            info: { busy: boolean };
            items: { kind: string }[];
          };
          return !chat.info.busy && chat.items.some((i) => i.kind === 'assistant') ? chat : null;
        },
        5,
      );
      return { detail: 'replied', tokens: await tokensBy(['King']) };
    });
    await step('the librarians review one skill', async () => {
      await call('PUT', '/api/library', { maxCandidates: 1 });
      await call('POST', '/api/library/run');
      await until(
        'the librarians',
        async () => (!(await call('GET', '/api/library')).running ? true : null),
        30,
      );
      const { entries, notes } = (await call('GET', '/api/skills')) as {
        entries: unknown[];
        notes: { text: string }[];
      };
      return {
        detail: `${entries.length} in the Archive; last note: ${notes[0]?.text ?? '(none)'}`,
        tokens: await tokensBy(['Scout', 'Reviewer']),
      };
    });
  } finally {
    server.kill();
    if (!process.argv.includes('--keep')) await rm(scratch, { recursive: true, force: true });
  }
}

// ------------------------------------------------------------------ report

await preflight();
if (live) await liveRun();
else
  console.log(
    '\nPreflight only. Run `npm run rehearse -- --live` to try each utility for real (uses your Claude usage).',
  );

const failed = steps.filter((s) => !s.ok);
const tokens = steps.reduce((n, s) => n + (s.tokens ?? 0), 0);
console.log(
  `\n${steps.length - failed.length}/${steps.length} passed` +
    (live ? `, ${tokens.toLocaleString('en')} tokens in all` : '') +
    (failed.length ? `. Failed: ${failed.map((s) => s.name).join('; ')}` : '.'),
);
process.exit(failed.length ? 1 : 0);
