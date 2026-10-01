import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ArchiveEntry } from './archive.ts';
import { installSkill } from './install.ts';

let dir: string;
let skillsDir: string;
let gitBase: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'guild-install-'));
  skillsDir = join(dir, 'home', '.claude', 'skills');
  gitBase = `file://${join(dir, 'remotes')}/`;
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@example.com', ...args], {
    cwd,
    stdio: 'pipe',
  })
    .toString()
    .trim();

/** A "GitHub" repository on disk, as remotes/<owner>/<repo>.git, with a skill in it. */
async function repo(files: Record<string, string>, extra?: (work: string) => Promise<void>) {
  const work = join(dir, 'work');
  await mkdir(work, { recursive: true });
  git(work, 'init', '-q', '-b', 'main');
  for (const [path, text] of Object.entries(files)) {
    await mkdir(join(work, path, '..'), { recursive: true });
    await writeFile(join(work, path), text);
  }
  await extra?.(work);
  git(work, 'add', '-A');
  git(work, 'commit', '-q', '-m', 'skills');
  const remote = join(dir, 'remotes', 'acme', 'skills.git');
  await mkdir(join(remote, '..'), { recursive: true });
  git(dir, 'clone', '-q', '--bare', work, remote);
  // Let a fetch by commit hash work, as it does on GitHub.
  git(remote, 'config', 'uploadpack.allowAnySHA1InWant', 'true');
  return git(work, 'rev-parse', 'HEAD');
}

const entry = (commit: string, over: Partial<ArchiveEntry> = {}): ArchiveEntry => ({
  id: 'x',
  name: 'csv-tools',
  repo: 'acme/skills',
  path: 'skills/csv-tools',
  commit,
  stars: 10,
  description: '',
  foundAt: 0,
  review: null,
  status: 'reviewed',
  installedAt: null,
  ...over,
});

describe('installSkill', () => {
  it('installs the skill folder at the reviewed commit, and nothing else from the repository', async () => {
    const commit = await repo({
      'skills/csv-tools/SKILL.md': '---\nname: csv-tools\n---\n',
      'skills/csv-tools/scripts/join.py': 'print(1)\n',
      'skills/other/SKILL.md': 'x',
      'README.md': 'root',
    });
    const dest = await installSkill(entry(commit), { skillsDir, gitBase });
    expect(dest).toBe(join(skillsDir, 'csv-tools'));
    expect((await readdir(dest)).sort()).toEqual(['SKILL.md', 'scripts']);
    expect(await readFile(join(dest, 'scripts', 'join.py'), 'utf8')).toBe('print(1)\n');
    expect(await readdir(skillsDir)).toEqual(['csv-tools']);
  });

  it('never replaces a skill already installed under that name', async () => {
    const commit = await repo({ 'skills/csv-tools/SKILL.md': 'new' });
    await mkdir(join(skillsDir, 'csv-tools'), { recursive: true });
    await writeFile(join(skillsDir, 'csv-tools', 'SKILL.md'), 'mine');
    await expect(installSkill(entry(commit), { skillsDir, gitBase })).rejects.toMatchObject({ status: 409 });
    expect(await readFile(join(skillsDir, 'csv-tools', 'SKILL.md'), 'utf8')).toBe('mine');
  });

  it('refuses a folder without SKILL.md, a commit that is not there, and symbolic links', async () => {
    const commit = await repo({ 'skills/csv-tools/notes.md': 'no skill here' });
    await expect(installSkill(entry(commit), { skillsDir, gitBase })).rejects.toMatchObject({ status: 422 });
    await expect(installSkill(entry('0'.repeat(40)), { skillsDir, gitBase })).rejects.toMatchObject({
      status: 502,
    });

    await rm(join(dir, 'work'), { recursive: true, force: true });
    await rm(join(dir, 'remotes'), { recursive: true, force: true });
    const linked = await repo({ 'skills/csv-tools/SKILL.md': 'x' }, async (work) => {
      await symlink('/etc/passwd', join(work, 'skills', 'csv-tools', 'passwd'));
    });
    await expect(installSkill(entry(linked), { skillsDir, gitBase })).rejects.toMatchObject({ status: 422 });
    await expect(readdir(skillsDir)).rejects.toThrow(); // nothing was created
  });
});
