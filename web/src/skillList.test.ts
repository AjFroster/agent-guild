import { describe, expect, it } from 'vitest';

import type { ArchiveEntry, InstalledSkill } from './api.ts';
import { nextSort, skillRows, sortSkills } from './skillList.ts';

const skill = (name: string, source: InstalledSkill['source'] = 'personal'): InstalledSkill => ({
  name,
  description: `${name} things`,
  source,
  path: `/skills/${name}`,
});
const installed = (name: string, stars: number): ArchiveEntry =>
  ({ name, stars, repo: `acme/${name}`, status: 'installed' }) as ArchiveEntry;

describe('the list of skills you have', () => {
  const rows = skillRows(
    [skill('pdf'), skill('csv-wrangler'), skill('pr-reviewer'), skill('notes'), skill('pdf-tools', 'plugin')],
    [installed('csv-wrangler', 6400), installed('pr-reviewer', 12300), installed('pdf-tools', 900)],
  );

  it('takes stars and repository from the Archive, for skills installed from it', () => {
    expect(rows.map((r) => [r.name, r.stars, r.repo])).toEqual([
      ['pdf', null, null],
      ['csv-wrangler', 6400, 'acme/csv-wrangler'],
      ['pr-reviewer', 12300, 'acme/pr-reviewer'],
      ['notes', null, null],
      ['pdf-tools', null, null], // a plugin's skill of the same name is not the Archive's
    ]);
  });

  it('sorts by stars either way, with unknown stars last and by name', () => {
    const names = (s: Parameters<typeof sortSkills>[1]) => sortSkills(rows, s).map((r) => r.name);
    expect(names({ key: 'stars', dir: 'desc' })).toEqual([
      'pr-reviewer',
      'csv-wrangler',
      'notes',
      'pdf',
      'pdf-tools',
    ]);
    expect(names({ key: 'stars', dir: 'asc' })).toEqual([
      'csv-wrangler',
      'pr-reviewer',
      'notes',
      'pdf',
      'pdf-tools',
    ]);
    expect(names({ key: 'name', dir: 'desc' })).toEqual([
      'pr-reviewer',
      'pdf-tools',
      'pdf',
      'notes',
      'csv-wrangler',
    ]);
  });

  it('flips direction on the same column and starts a new one sensibly', () => {
    expect(nextSort({ key: 'stars', dir: 'desc' }, 'stars')).toEqual({ key: 'stars', dir: 'asc' });
    expect(nextSort({ key: 'stars', dir: 'desc' }, 'name')).toEqual({ key: 'name', dir: 'asc' });
    expect(nextSort({ key: 'name', dir: 'asc' }, 'stars')).toEqual({ key: 'stars', dir: 'desc' });
  });
});
