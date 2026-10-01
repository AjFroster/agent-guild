import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadToken } from './token.ts';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'guild-token-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('loadToken', () => {
  it('creates a private token once and reuses it', async () => {
    const file = join(dir, 'nested', 'token');
    const first = await loadToken(file);
    expect(first).toMatch(/^[0-9a-f]{48}$/);
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    expect(await loadToken(file)).toBe(first);
  });

  it('tightens a token file that was made readable by others', async () => {
    const file = join(dir, 'token');
    const token = 'a'.repeat(48);
    await writeFile(file, token, { mode: 0o644 });
    expect(await loadToken(file)).toBe(token);
    expect((await stat(file)).mode & 0o777).toBe(0o600);
  });

  it('replaces a malformed token rather than trusting it', async () => {
    const file = join(dir, 'token');
    await writeFile(file, 'short');
    const token = await loadToken(file);
    expect(token).toMatch(/^[0-9a-f]{48}$/);
    expect((await readFile(file, 'utf8')).trim()).toBe(token);
  });
});
