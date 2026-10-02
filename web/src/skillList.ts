import type { ArchiveEntry, InstalledSkill } from './api.ts';

/**
 * The skills the user has, for the Library page's list. Stars are only known for skills
 * installed from the Archive (the librarians read them from GitHub); a skill the user wrote
 * or got from a plugin has none, and sorts after every skill that has.
 */
export interface SkillRow {
  name: string;
  description: string;
  source: InstalledSkill['source'];
  /** For a project's own skill (one the Forge made, say): the project's folder name. */
  project: string | null;
  stars: number | null;
  /** The GitHub repository, for a skill installed from the Archive. */
  repo: string | null;
}

export type SkillSort = { key: 'stars' | 'name'; dir: 'asc' | 'desc' };

export function skillRows(installed: InstalledSkill[], entries: ArchiveEntry[]): SkillRow[] {
  const fromArchive = new Map(entries.filter((e) => e.status === 'installed').map((e) => [e.name, e]));
  return installed.map((s) => {
    // Only a personal skill can be one the Archive installed: plugins and projects bring their own.
    const entry = s.source === 'personal' || s.source === 'synced' ? fromArchive.get(s.name) : undefined;
    return {
      name: s.name,
      description: s.description,
      source: s.source,
      project: s.project ?? null,
      stars: entry?.stars ?? null,
      repo: entry?.repo ?? null,
    };
  });
}

export function sortSkills(rows: SkillRow[], { key, dir }: SkillSort): SkillRow[] {
  const sign = dir === 'asc' ? 1 : -1;
  const byName = (a: SkillRow, b: SkillRow) => a.name.localeCompare(b.name);
  return [...rows].sort((a, b) => {
    if (key === 'name') return sign * byName(a, b);
    // Unknown stars go last whichever way the list is sorted.
    if (a.stars === null || b.stars === null)
      return a.stars === b.stars ? byName(a, b) : a.stars === null ? 1 : -1;
    return sign * (a.stars - b.stars) || byName(a, b);
  });
}

/** Clicking a column: the same one flips direction; a new one starts stars high-first, names A-Z. */
export function nextSort(current: SkillSort, key: SkillSort['key']): SkillSort {
  if (current.key === key) return { key, dir: current.dir === 'asc' ? 'desc' : 'asc' };
  return { key, dir: key === 'stars' ? 'desc' : 'asc' };
}
