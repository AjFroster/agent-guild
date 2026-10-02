import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { installedSkills, parseFrontmatter } from './skills.ts';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'guild-skills-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function skill(path: string, text: string) {
  await mkdir(join(dir, path), { recursive: true });
  await writeFile(join(dir, path, 'SKILL.md'), text);
}

describe('parseFrontmatter', () => {
  it('reads plain, quoted and folded values', () => {
    expect(parseFrontmatter('---\nname: pdf\ndescription: Read and write PDFs\n---\n# PDF')).toEqual({
      name: 'pdf',
      description: 'Read and write PDFs',
    });
    expect(parseFrontmatter('---\nname: "quoted"\ndescription: \'single\'\n---')).toEqual({
      name: 'quoted',
      description: 'single',
    });
    expect(
      parseFrontmatter('---\nname: folded\ndescription: >\n  One line\n  and another\nlicense: MIT\n---'),
    ).toEqual({
      name: 'folded',
      description: 'One line and another',
    });
  });

  it('gives nothing for a file without frontmatter', () => {
    expect(parseFrontmatter('# Just a heading')).toEqual({});
  });
});

describe('installedSkills', () => {
  it('lists personal, synced and plugin skills with their names and descriptions', async () => {
    await skill('skills/pdf', '---\nname: pdf\ndescription: PDFs\n---');
    await skill('skills/synced/org-1/docx', '---\nname: docx\ndescription: Word files\n---');
    await skill('skills/untitled', '# no frontmatter');
    await skill('plugins/cache/acme/tools/1.0/skills/linter', '---\nname: linter\ndescription: Lints\n---');
    const skills = await installedSkills(join(dir, 'skills'), join(dir, 'plugins'));
    expect(skills).toEqual([
      { name: 'pdf', description: 'PDFs', source: 'personal', path: 'pdf' },
      { name: 'docx', description: 'Word files', source: 'synced', path: join('synced', 'org-1', 'docx') },
      { name: 'untitled', description: '', source: 'personal', path: 'untitled' },
      {
        name: 'linter',
        description: 'Lints',
        source: 'plugin',
        path: join('cache', 'acme', 'tools', '1.0', 'skills', 'linter'),
      },
    ]);
  });

  it("lists each project's own skills, by the project's folder name only", async () => {
    await skill(
      'work/bakery/.claude/skills/release-notes',
      '---\nname: release-notes\ndescription: Notes\n---',
    );
    await skill('work/bakery/.claude/skills/deep/er/hidden', '---\nname: hidden\n---');
    const bakery = join(dir, 'work', 'bakery');
    const skills = await installedSkills(join(dir, 'skills'), undefined, [bakery, bakery, join(dir, 'gone')]);
    expect(skills).toEqual([
      {
        name: 'release-notes',
        description: 'Notes',
        source: 'project',
        path: 'release-notes',
        project: 'bakery',
      },
    ]);
  });

  it('is empty when the folders do not exist', async () => {
    expect(await installedSkills(join(dir, 'nope'), join(dir, 'nor-this'))).toEqual([]);
  });
});
