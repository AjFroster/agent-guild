import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { RunLog, failedRuns } from './runs.ts';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'runs-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('RunLog', () => {
  it('keeps the newest runs first, at most 100, and counts the failures', async () => {
    const log = new RunLog(join(dir, 'runs.json'));
    for (let i = 0; i < 105; i++)
      await log.add({ utility: 'forge', startedAt: i, endedAt: i + 1, ok: i % 10 !== 0, detail: `run ${i}` });
    const runs = await log.runs();
    expect(runs).toHaveLength(100);
    expect(runs[0]!.detail).toBe('run 104');
    expect(failedRuns(runs)).toBe(10);
  });
});
