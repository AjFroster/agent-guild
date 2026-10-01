import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { JsonStore, list } from './jsonStore.ts';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'json-store-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const store = (file: string) =>
  new JsonStore(file, (raw: { items?: unknown }) => ({ items: list<number>(raw.items) }));

describe('JsonStore', () => {
  it('reads a missing or broken file as empty', async () => {
    expect(await store(join(dir, 'none.json')).read()).toEqual({ items: [] });
    await writeFile(join(dir, 'bad.json'), '{ not json');
    expect(await store(join(dir, 'bad.json')).read()).toEqual({ items: [] });
  });

  it('runs changes one after another, so none is lost, and keeps the file private', async () => {
    const file = join(dir, 'sub', 'data.json');
    const s = store(file);
    await Promise.all(Array.from({ length: 20 }, (_, i) => s.change((d) => d.items.push(i))));
    expect((await s.read()).items).toHaveLength(20);
    expect((await stat(file)).mode & 0o777).toBe(0o600);
  });

  it('keeps going after a change that throws', async () => {
    const s = store(join(dir, 'data.json'));
    await expect(
      s.change(() => {
        throw new Error('no');
      }),
    ).rejects.toThrow('no');
    await s.change((d) => d.items.push(1));
    expect((await s.read()).items).toEqual([1]);
  });
});
