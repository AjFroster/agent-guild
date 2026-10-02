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
    name: 'halt_knight',
    description: "Stop a Knight's current turn. Its session is kept and can be given new orders.",
    inputSchema: { type: 'object', properties: { knight: knightArg }, required: ['knight'] },
    run: async (args, call) =>
      text(await call('POST', `/api/king/knights/${encodeURIComponent(String(args.knight))}/halt`)),
  },
];

type Rpc = {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
};

/** Answer one JSON-RPC message; null for notifications, which get no answer. */
export async function handle(message: Rpc, call: GuildCall): Promise<Record<string, unknown> | null> {
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
        tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
      });
    case 'tools/call': {
      const tool = TOOLS.find((t) => t.name === message.params?.name);
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
  const call = guildClient(url, token);
  createInterface({ input: process.stdin }).on('line', (line) => {
    let message: Rpc;
    try {
      message = JSON.parse(line) as Rpc;
    } catch {
      return;
    }
    void handle(message, call).then((answer) => {
      if (answer) process.stdout.write(JSON.stringify(answer) + '\n');
    });
  });
}
