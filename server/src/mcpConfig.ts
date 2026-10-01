import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

/**
 * The MCP config a guild session's CLI reads (`--mcp-config`): one server, `guild`, which is
 * kingMcp.ts in the given role. It holds the token, so it is written readable by the user
 * only, like the token file itself. One writer for the King, the librarians, the smiths and
 * the Knights.
 *
 * `role` is omitted for the King, whose tools are kingMcp.ts's default.
 */
export async function writeMcpConfig(
  file: string,
  { guildUrl, token, role }: { guildUrl: string; token: string; role?: string },
): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  const config = {
    mcpServers: {
      guild: {
        command: process.execPath,
        args: [resolve(import.meta.dirname, 'kingMcp.ts')],
        env: { GUILD_URL: guildUrl, GUILD_TOKEN: token, ...(role ? { GUILD_ROLE: role } : {}) },
      },
    },
  };
  await writeFile(file, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 });
}
