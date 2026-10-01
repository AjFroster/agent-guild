import { readFile, readdir } from 'node:fs/promises';
import { basename, join, relative, sep } from 'node:path';

/**
 * The skills already installed, so the librarians can tell a new skill that fills a gap
 * from one that repeats what the user has. Read-only: names, descriptions and where each
 * came from, taken from the frontmatter at the top of every SKILL.md.
 */

export interface InstalledSkill {
  name: string;
  description: string;
  /**
   * "personal" (the user's skills folder), "synced" (from claude.ai), "plugin", or
   * "project" (a project's own `.claude/skills`, where the Forge installs).
   */
  source: 'personal' | 'synced' | 'plugin' | 'project';
  /** Folder of the skill, relative to the folder it was found under. */
  path: string;
  /** For a project's skill: the project's folder name (never its full path). */
  project?: string;
}

/**
 * The `name:` and `description:` of a SKILL.md frontmatter block. Handles plain, quoted
 * and folded (`>` or `|`) values; anything else in the block is ignored.
 */
export function parseFrontmatter(text: string): { name?: string; description?: string } {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  if (lines[0]?.trim() !== '---') return {};
  const end = lines.indexOf('---', 1);
  const block = lines.slice(1, end === -1 ? lines.length : end);
  const out: Record<string, string> = {};
  for (let i = 0; i < block.length; i++) {
    const m = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(block[i]!);
    if (!m) continue;
    const [, key, raw] = m;
    let value = raw!.trim();
    if (value === '>' || value === '|' || value === '>-' || value === '|-') {
      const folded: string[] = [];
      while (i + 1 < block.length && /^\s+\S/.test(block[i + 1]!)) folded.push(block[++i]!.trim());
      value = folded.join(value.startsWith('>') ? ' ' : '\n');
    } else if (/^(['"]).*\1$/.test(value)) {
      value = value.slice(1, -1);
    }
    out[key!] = value;
  }
  return {
    ...(out.name ? { name: out.name } : {}),
    ...(out.description ? { description: out.description } : {}),
  };
}

/** Every SKILL.md under `root`, at most `depth` folders down. Missing folders are empty. */
async function findSkillFiles(root: string, depth: number): Promise<string[]> {
  const found: string[] = [];
  const walk = async (dir: string, left: number) => {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.isFile() && e.name === 'SKILL.md') found.push(join(dir, e.name));
      else if (e.isDirectory() && left > 0 && !e.name.startsWith('.') && e.name !== 'node_modules') {
        await walk(join(dir, e.name), left - 1);
      }
    }
  };
  await walk(root, depth);
  return found.sort();
}

/**
 * The installed skills: the user's own and synced ones in `skillsDir`, those that plugins
 * bring in `pluginsDir`, and each project's own in `<project>/.claude/skills`. A skill with
 * no name in its frontmatter is named after its folder.
 */
export async function installedSkills(
  skillsDir: string,
  pluginsDir?: string,
  projects: readonly string[] = [],
): Promise<InstalledSkill[]> {
  const read = async (root: string, depth: number, source: (rel: string) => InstalledSkill['source']) => {
    const skills: InstalledSkill[] = [];
    for (const file of await findSkillFiles(root, depth)) {
      let text: string;
      try {
        text = await readFile(file, 'utf8');
      } catch {
        continue;
      }
      const meta = parseFrontmatter(text.slice(0, 8_000));
      const folder = relative(root, join(file, '..'));
      const fallback = folder.split(sep).pop() || 'skill';
      skills.push({
        name: (meta.name ?? fallback).slice(0, 80),
        description: (meta.description ?? '').slice(0, 600),
        source: source(folder),
        path: folder,
      });
    }
    return skills;
  };
  return [
    ...(await read(skillsDir, 3, (rel) => (rel.split(sep)[0] === 'synced' ? 'synced' : 'personal'))),
    ...(pluginsDir ? await read(pluginsDir, 6, () => 'plugin') : []),
    ...(
      await Promise.all(
        [...new Set(projects)].map(async (dir) =>
          (await read(join(dir, '.claude', 'skills'), 2, () => 'project')).map((s) => ({
            ...s,
            project: basename(dir),
          })),
        ),
      )
    ).flat(),
  ];
}
