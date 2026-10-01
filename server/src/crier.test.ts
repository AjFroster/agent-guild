import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ChatManager, StartRequest } from './chats.ts';
import { DEFAULT_CRIER, TownCrier, crierPrompt, isDue, nextRun, validatePatch } from './crier.ts';

const at = (h: number, m = 0, day = 1) => new Date(2026, 9, day, h, m);

describe('schedule', () => {
  const cfg = { ...DEFAULT_CRIER, time: '18:00' };

  it('is due once the time has passed, and only once a day', () => {
    expect(isDue(cfg, at(17, 59))).toBe(false);
    expect(isDue(cfg, at(18, 0))).toBe(true);
    expect(isDue(cfg, at(23, 30))).toBe(true); // machine was off at 18:00: catch up
    expect(isDue({ ...cfg, lastRunDate: '2026-10-01' }, at(19))).toBe(false);
    expect(isDue({ ...cfg, lastRunDate: '2026-09-30' }, at(19))).toBe(true);
    expect(isDue({ ...cfg, enabled: false }, at(19))).toBe(false);
  });

  it('reports the next run: today, tomorrow, now if missed, or never when off', () => {
    expect(nextRun(cfg, at(9))).toEqual(at(18));
    expect(nextRun({ ...cfg, lastRunDate: '2026-10-01' }, at(19))).toEqual(at(18, 0, 2));
    expect(nextRun(cfg, at(19))).toEqual(at(19));
    expect(nextRun({ ...cfg, enabled: false }, at(9))).toBeNull();
  });

  it('validates settings', () => {
    expect(validatePatch({ time: '07:05', threshold: 8, maxItems: 5 })).toEqual({
      time: '07:05',
      threshold: 8,
      maxItems: 5,
    });
    expect(() => validatePatch({ time: '7pm' })).toThrow(/HH:MM/);
    expect(() => validatePatch({ threshold: 11 })).toThrow(/1 to 10/);
    expect(() => validatePatch({ threshold: 6.5 })).toThrow();
    expect(() => validatePatch({ maxItems: 0 })).toThrow();
  });

  it('puts the cutoff, cap and file name in the prompt', () => {
    const p = crierPrompt({ ...cfg, threshold: 8, maxItems: 4 }, '2026-10-01');
    expect(p).toContain('scoring 8 or higher, at most 4');
    expect(p).toContain('2026-10-01.md');
    expect(p).toContain('Below the bar');
  });
});

describe('TownCrier', () => {
  let dir: string;
  let started: StartRequest[];
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'crier-'));
    started = [];
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const crier = (now: Date) =>
    new TownCrier({
      dir,
      now: () => now,
      chats: {
        start: async (req: StartRequest) => {
          started.push(req);
          return { id: 'chat-1' };
        },
      } as unknown as ChatManager,
    });

  it('runs when due, in its reports folder, with web tools allowed, and records the day', async () => {
    const c = crier(at(18, 5));
    await c.load();
    await c.tick();
    await c.tick(); // second tick the same day does nothing
    expect(started).toHaveLength(1);
    expect(started[0]).toMatchObject({
      name: 'Town Crier',
      cwd: join(dir, 'town-crier'),
      mode: 'acceptEdits',
      allowedTools: ['WebSearch', 'WebFetch'],
    });
    const saved = JSON.parse(await readFile(join(dir, 'town-crier.json'), 'utf8'));
    expect(saved).toMatchObject({ lastRunDate: '2026-10-01', lastChatId: 'chat-1' });
  });

  it('lists and reads reports, ignoring other files and bad dates', async () => {
    const c = crier(at(9));
    await c.run();
    await writeFile(join(c.reportsDir, '2026-10-01.md'), '# Town Crier');
    await writeFile(join(c.reportsDir, 'notes.txt'), 'x');
    expect(await c.reports()).toEqual([{ date: '2026-10-01', bytes: 12 }]);
    expect(await c.report('2026-10-01')).toBe('# Town Crier');
    expect(await c.report('../town-crier')).toBeNull();
  });
});
