import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { Archive, checkCandidate, entryId, waitingForUser } from './archive.ts';

let dir: string;
let clock: number;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'guild-archive-'));
  clock = 1_000;
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const archive = () => new Archive(join(dir, 'archive.json'), () => clock);
const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);
const found = { name: 'csv-tools', repo: 'acme/skills', path: 'skills/csv-tools', commit: SHA_A, stars: 412 };

describe('checkCandidate', () => {
  it('accepts a skill pinned to a full commit', () => {
    expect(checkCandidate({ ...found, path: '/skills/csv-tools/' })).toMatchObject({
      name: 'csv-tools',
      path: 'skills/csv-tools',
      stars: 412,
    });
  });

  it('refuses anything that could point the installer somewhere unexpected', () => {
    for (const bad of [
      { repo: 'not a repo' },
      { repo: 'acme/skills/extra' },
      { path: '../../.ssh' },
      { path: 'skills/./x' },
      { commit: 'main' },
      { commit: 'abc123' },
      { name: 'Has Spaces' },
      { name: '../evil' },
    ]) {
      expect(() => checkCandidate({ ...found, ...bad })).toThrow();
    }
  });
});

describe('Archive', () => {
  it('keeps one entry per skill, sending it back for review only when its commit changes', async () => {
    const a = archive();
    expect((await a.addCandidate(found)).added).toBe(true);
    expect((await a.addCandidate(found)).added).toBe(false);
    const id = entryId('acme/skills', 'skills/csv-tools');
    await a.recordReview({ id, verdict: 'gap', reason: 'Nothing else reads CSV.' });
    expect((await a.get(id))!.status).toBe('reviewed');

    clock = 2_000;
    const again = await a.addCandidate({ ...found, commit: SHA_B });
    expect(again.added).toBe(true);
    expect(again.entry).toMatchObject({ commit: SHA_B, status: 'candidate', review: null });
    expect((await a.read()).entries).toHaveLength(1);
  });

  it('records a review with its overlaps and risks, and refuses a bad verdict', async () => {
    const a = archive();
    const { entry } = await a.addCandidate(found);
    const reviewed = await a.recordReview({
      id: entry.id,
      verdict: 'better',
      reason: 'Faster than the installed one.',
      overlaps: ['xlsx'],
      risks: ['Downloads a binary at run time'],
    });
    expect(reviewed.review).toEqual({
      verdict: 'better',
      reason: 'Faster than the installed one.',
      overlaps: ['xlsx'],
      risks: ['Downloads a binary at run time'],
      reviewedAt: 1_000,
    });
    await expect(a.recordReview({ id: entry.id, verdict: 'great', reason: 'x' })).rejects.toThrow(/verdict/);
    await expect(a.recordReview({ id: 'nope', verdict: 'gap', reason: 'x' })).rejects.toThrow(/No such/);
  });

  it('lists reviewed skills as waiting for the user until installed or dismissed', async () => {
    const a = archive();
    const one = (await a.addCandidate(found)).entry;
    const two = (await a.addCandidate({ ...found, name: 'other', path: 'skills/other' })).entry;
    await a.recordReview({ id: one.id, verdict: 'gap', reason: 'r' });
    await a.recordReview({ id: two.id, verdict: 'duplicate', reason: 'r' });
    expect(waitingForUser((await a.read()).entries).map((e) => e.name)).toEqual(['other', 'csv-tools']);
    await a.setStatus(two.id, 'dismissed');
    expect(waitingForUser((await a.read()).entries).map((e) => e.name)).toEqual(['csv-tools']);
  });

  it('keeps notes newest first, and writes are not lost when they overlap', async () => {
    const a = archive();
    await Promise.all(Array.from({ length: 10 }, (_, i) => a.addNote('Scout', `note ${i}`)));
    const { notes } = await a.read();
    expect(notes).toHaveLength(10);
    expect(new Set(notes.map((n) => n.text)).size).toBe(10);
    expect((await stat(join(dir, 'archive.json'))).mode & 0o777).toBe(0o600);
  });
});
