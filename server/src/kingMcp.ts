#!/usr/bin/env node
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

/**
 * The King's tools: a small MCP server (stdio, JSON-RPC 2.0, one message per line) that
 * the King's Claude Code session starts from its `--mcp-config`. Each tool is one call to
 * the guild server's /api/king routes, which do the real work and enforce the rules; this
 * file only translates. It reads GUILD_URL and GUILD_TOKEN from its environment, which
 * the guild writes into a config file only the user can read.
 *
 * Logs go to stderr: stdout carries the protocol.
 */

export type GuildCall = (method: 'GET' | 'POST', path: string, body?: unknown) => Promise<unknown>;

interface Tool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  run: (args: Record<string, unknown>, call: GuildCall) => Promise<string>;
}

const knightArg = {
  type: 'string',
  description: 'The Knight: its name as list_knights shows it, or its session id.',
};
const waitArg = {
  type: 'integer',
  minimum: 0,
  maximum: 240,
  description:
    'Seconds to wait for the Knight to finish its turn (default 120). If it is still working when this runs out, check on it later with read_knight.',
};

const text = (v: unknown) => (typeof v === 'string' ? v : JSON.stringify(v, null, 2));

export const TOOLS: Tool[] = [
  {
    name: 'list_knights',
    description:
      'List the Knights (Claude Code sessions) in the kingdom: what each is doing, its folder and branch, its quests, its party of sub-agents, and whether it has unpushed work. Call this first.',
    inputSchema: { type: 'object', properties: {} },
    run: async (_, call) => text(await call('GET', '/api/king/knights')),
  },
  {
    name: 'read_knight',
    description: "Read a Knight's latest conversation: what it was asked and what it answered.",
    inputSchema: {
      type: 'object',
      properties: {
        knight: knightArg,
        last: { type: 'integer', minimum: 1, maximum: 40, description: 'How many messages (default 10).' },
      },
      required: ['knight'],
    },
    run: async (args, call) => {
      const last = Number(args.last ?? 10);
      return text(
        await call('GET', `/api/king/knights/${encodeURIComponent(String(args.knight))}?last=${last}`),
      );
    },
  },
  {
    name: 'command_knight',
    description:
      'Give an existing Knight an order. It continues its own session with this as the next message, so it keeps everything it already knows. Waits for its answer. Refused if the Knight is mid-turn or someone is using it in a terminal.',
    inputSchema: {
      type: 'object',
      properties: {
        knight: knightArg,
        order: { type: 'string', description: 'The order, written as a complete instruction.' },
        wait_seconds: waitArg,
      },
      required: ['knight', 'order'],
    },
    run: async (args, call) =>
      text(
        await call('POST', `/api/king/knights/${encodeURIComponent(String(args.knight))}/orders`, {
          order: args.order,
          waitSeconds: args.wait_seconds,
        }),
      ),
  },
  {
    name: 'raise_knight',
    description:
      'Start a new Knight: a new Claude Code session in a folder inside the home directory, given its first order. Use for work that no existing Knight covers. Waits for its first answer.',
    inputSchema: {
      type: 'object',
      properties: {
        folder: { type: 'string', description: 'Absolute path of the project folder it works in.' },
        name: { type: 'string', description: 'A short name for the Knight (max 40 characters).' },
        order: { type: 'string', description: 'Its first order, written as a complete instruction.' },
        mode: {
          type: 'string',
          enum: ['acceptEdits', 'plan', 'auto', 'default'],
          description:
            'Permissions: acceptEdits (edit files, ask for the rest; the default), plan (read and propose only), auto, or default (ask for everything).',
        },
        wait_seconds: waitArg,
      },
      required: ['folder', 'name', 'order'],
    },
    run: async (args, call) =>
      text(
        await call('POST', '/api/king/knights', {
          folder: args.folder,
          name: args.name,
          order: args.order,
          mode: args.mode,
          waitSeconds: args.wait_seconds,
        }),
      ),
  },
  {
    name: 'consult_archive',
    description:
      "What the librarians' Archive knows: the skills installed for every Knight (with what each is for), those the user installed recently on the librarians' advice, and the librarians' latest notes. Use it to name a fitting skill in an order.",
    inputSchema: { type: 'object', properties: {} },
    run: async (_, call) => text(await call('GET', '/api/king/archive')),
  },
  {
    name: 'commission_equipment',
    description:
      "Ask the Forge to make equipment for a Knight's project: a skill or a slash command it is missing. The Blacksmith forges it, the Library reviews it, and the user decides whether to install it; the Knight is told when it is in place.",
    inputSchema: {
      type: 'object',
      properties: {
        knight: knightArg,
        kind: { type: 'string', enum: ['skill', 'command'] },
        need: {
          type: 'string',
          description: 'What the piece must do, for that project, in a sentence or two.',
        },
      },
      required: ['knight', 'kind', 'need'],
    },
    run: async (args, call) => text(await call('POST', '/api/forge/commission', args)),
  },
  {
    name: 'halt_knight',
    description: "Stop a Knight's current turn. Its session is kept and can be given new orders.",
    inputSchema: { type: 'object', properties: { knight: knightArg }, required: ['knight'] },
    run: async (args, call) =>
      text(await call('POST', `/api/king/knights/${encodeURIComponent(String(args.knight))}/halt`)),
  },
];

// ------------------------------------------------------------------ the librarians

const listInstalled: Tool = {
  name: 'list_installed_skills',
  description:
    "The skills the user already has: each one's name, description and source. Compare new skills against these.",
  inputSchema: { type: 'object', properties: {} },
  run: async (_, call) => text(await call('GET', '/api/library/installed')),
};

const writeNote: Tool = {
  name: 'write_note',
  description:
    'Leave a short note in the Archive for the user and the King: what you did this run, in a sentence or two.',
  inputSchema: {
    type: 'object',
    properties: { text: { type: 'string', description: 'The note, under 300 characters.' } },
    required: ['text'],
  },
  run: async (args, call) =>
    text(await call('POST', '/api/library/notes', { by: String(args.by ?? ''), text: args.text })),
};

/** The Scout: finds skills, records them as candidates. Cannot review or install. */
export const SCOUT_TOOLS: Tool[] = [
  listInstalled,
  {
    name: 'list_archive',
    description:
      'Every skill already in the Archive (any status), so you do not add one twice at the same commit.',
    inputSchema: { type: 'object', properties: {} },
    run: async (_, call) => text(await call('GET', '/api/library/archive')),
  },
  {
    name: 'add_candidate',
    description:
      "Add a skill you found to the Archive for the Reviewer. Pin it to the default branch's latest commit: the full 40-character hash.",
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: "The skill's name from its SKILL.md: lowercase, digits, hyphens.",
        },
        repo: { type: 'string', description: 'The GitHub repository, "owner/name".' },
        path: {
          type: 'string',
          description: 'The folder holding SKILL.md inside the repository ("" for the root).',
        },
        commit: { type: 'string', description: 'The full 40-character commit hash it was found at.' },
        stars: { type: 'integer', description: "The repository's stars." },
        description: { type: 'string', description: "The skill's description from its SKILL.md." },
      },
      required: ['name', 'repo', 'path', 'commit', 'stars'],
    },
    run: async (args, call) => text(await call('POST', '/api/library/candidates', args)),
  },
  writeNote,
];

/** The Reviewer: judges the Scout's candidates. Cannot add candidates or install. */
export const REVIEWER_TOOLS: Tool[] = [
  listInstalled,
  {
    name: 'list_candidates',
    description: 'The skills waiting for review, each with its id, repository, folder and pinned commit.',
    inputSchema: { type: 'object', properties: {} },
    run: async (_, call) => text(await call('GET', '/api/library/candidates')),
  },
  {
    name: 'record_review',
    description: 'Record your verdict on one candidate. The user decides what to install from these.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: "The candidate's id from list_candidates." },
        verdict: {
          type: 'string',
          enum: ['gap', 'better', 'duplicate', 'risky'],
          description:
            'gap: does something no installed skill does. better: does what an installed skill does, clearly better. duplicate: nothing new. risky: anything unsafe found, whatever else it offers.',
        },
        reason: { type: 'string', description: 'Why, in one to three sentences.' },
        overlaps: {
          type: 'array',
          items: { type: 'string' },
          description: 'Installed skills it overlaps, by name.',
        },
        risks: {
          type: 'array',
          items: { type: 'string' },
          description: 'Each risk found, concretely, with the file.',
        },
      },
      required: ['id', 'verdict', 'reason'],
    },
    run: async (args, call) => text(await call('POST', '/api/library/reviews', args)),
  },
  writeNote,
];

const kindArg = {
  type: 'string',
  enum: ['skill', 'command'],
  description: 'skill: know-how for a task, used when it fits. command: a slash command you run on purpose.',
};

/** A Knight: may ask the Forge for equipment, and see what it asked for. */
export const KNIGHT_TOOLS: Tool[] = [
  {
    name: 'request_equipment',
    description:
      "Ask the guild's Forge for a skill or slash command this project is missing: something you keep needing and have to work out by hand each time. The Blacksmith forges it from this project, the Library reviews it, and the user decides. You are told when it is installed; carry on meanwhile.",
    inputSchema: {
      type: 'object',
      properties: {
        kind: kindArg,
        need: { type: 'string', description: 'What it must do, in a sentence or two, and why you need it.' },
      },
      required: ['kind', 'need'],
    },
    run: async (args, call) => text(await call('POST', '/api/forge/requests', args)),
  },
  {
    name: 'check_equipment',
    description:
      'What this project has asked the Forge for, and where each piece is: forging, reviewed, installed.',
    inputSchema: { type: 'object', properties: {} },
    run: async (_, call) => text(await call('GET', '/api/forge/requests')),
  },
];

/** The Blacksmith: reads its order, hangs its piece. Cannot install. */
export const SMITH_TOOLS: Tool[] = [
  {
    name: 'read_order',
    description: 'The order on the anvil: what kind of piece, what is needed, and who asked.',
    inputSchema: { type: 'object', properties: {} },
    run: async (_, call) => text(await call('GET', '/api/forge/anvil')),
  },
  {
    name: 'submit_piece',
    description:
      'Hang the finished piece on the rack for review. A skill: SKILL.md (front matter with name and description) plus any other files. A command: one file named <name>.md.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: "The order's id from read_order." },
        name: { type: 'string', description: 'Lowercase letters, digits and hyphens.' },
        description: { type: 'string', description: 'What it does, in one line.' },
        files: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              path: { type: 'string', description: 'Relative path inside the piece, e.g. SKILL.md.' },
              content: { type: 'string' },
            },
            required: ['path', 'content'],
          },
        },
      },
      required: ['id', 'name', 'files'],
    },
    run: async (args, call) => text(await call('POST', '/api/forge/pieces', args)),
  },
];

/** The Reviewer at the Forge: tests forged pieces. Cannot forge or install. */
export const FORGE_REVIEWER_TOOLS: Tool[] = [
  {
    name: 'list_forged',
    description: 'The pieces waiting for review: what was asked, by whom, and every file.',
    inputSchema: { type: 'object', properties: {} },
    run: async (_, call) => text(await call('GET', '/api/forge/forged')),
  },
  {
    name: 'review_piece',
    description: 'Record your verdict on one piece. The user decides what to install.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: "The piece's order id from list_forged." },
        verdict: {
          type: 'string',
          enum: ['ready', 'needs-work', 'risky'],
          description: 'ready: install as it is. needs-work: forge again (say what). risky: anything unsafe.',
        },
        reason: { type: 'string', description: 'Why, in one to three sentences.' },
        risks: { type: 'array', items: { type: 'string' }, description: 'Each risk found, with the file.' },
      },
      required: ['id', 'verdict', 'reason'],
    },
    run: async (args, call) => text(await call('POST', '/api/forge/reviews', args)),
  },
];

const TOOLSETS: Record<string, Tool[]> = {
  king: TOOLS,
  scout: SCOUT_TOOLS,
  reviewer: REVIEWER_TOOLS,
  knight: KNIGHT_TOOLS,
  smith: SMITH_TOOLS,
  'forge-reviewer': FORGE_REVIEWER_TOOLS,
};
const ROLE_NAME: Record<string, string> = {
  king: 'King',
  scout: 'Scout Librarian',
  reviewer: 'Reviewing Librarian',
};

type Rpc = {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
};

/** Answer one JSON-RPC message; null for notifications, which get no answer. */
export async function handle(
  message: Rpc,
  call: GuildCall,
  tools: Tool[] = TOOLS,
): Promise<Record<string, unknown> | null> {
  const id = message.id;
  if (id === undefined || id === null) return null;
  const reply = (result: unknown) => ({ jsonrpc: '2.0', id, result });
  switch (message.method) {
    case 'initialize':
      return reply({
        protocolVersion: String(message.params?.protocolVersion ?? '2025-06-18'),
        capabilities: { tools: {} },
        serverInfo: { name: 'guild', version: '1.0.0' },
      });
    case 'ping':
      return reply({});
    case 'tools/list':
      return reply({
        tools: tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
      });
    case 'tools/call': {
      const tool = tools.find((t) => t.name === message.params?.name);
      if (!tool)
        return {
          jsonrpc: '2.0',
          id,
          error: { code: -32602, message: `Unknown tool ${String(message.params?.name)}` },
        };
      const args = (message.params?.arguments ?? {}) as Record<string, unknown>;
      try {
        return reply({ content: [{ type: 'text', text: await tool.run(args, call) }] });
      } catch (err) {
        // A refusal is an answer the King should read and act on, not a protocol error.
        return reply({ content: [{ type: 'text', text: (err as Error).message }], isError: true });
      }
    }
    default:
      return {
        jsonrpc: '2.0',
        id,
        error: { code: -32601, message: `Unknown method ${String(message.method)}` },
      };
  }
}

/** Calls to the guild server with the token; a refusal becomes an Error carrying its reason. */
export function guildClient(url: string, token: string): GuildCall {
  return async (method, path, body) => {
    const res = await fetch(new URL(path, url), {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) throw new Error(data.error ?? `The guild refused (${res.status}).`);
    return data;
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const url = process.env.GUILD_URL;
  const token = process.env.GUILD_TOKEN;
  if (!url || !token) {
    process.stderr.write('guild MCP: GUILD_URL and GUILD_TOKEN must be set\n');
    process.exit(1);
  }
  const role = process.env.GUILD_ROLE ?? 'king';
  const tools = TOOLSETS[role];
  if (!tools) {
    process.stderr.write(`guild MCP: unknown GUILD_ROLE "${role}"\n`);
    process.exit(1);
  }
  const base = guildClient(url, token);
  // A note says who wrote it, and a Knight's request where it works: both filled in here
  // from this process, not by the model.
  const here = process.cwd();
  const call: GuildCall = (method, path, body) => {
    if (path === '/api/library/notes' && body)
      return base(method, path, { ...(body as object), by: ROLE_NAME[role] });
    if (path === '/api/forge/requests')
      return method === 'GET'
        ? base(method, `${path}?cwd=${encodeURIComponent(here)}`)
        : base(method, path, { ...(body as object), cwd: here });
    return base(method, path, body);
  };
  createInterface({ input: process.stdin }).on('line', (line) => {
    let message: Rpc;
    try {
      message = JSON.parse(line) as Rpc;
    } catch {
      return;
    }
    void handle(message, call, tools).then((answer) => {
      if (answer) process.stdout.write(JSON.stringify(answer) + '\n');
    });
  });
}
