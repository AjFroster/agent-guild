import { execFile } from 'node:child_process';
import { cp, lstat, mkdir, mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ArchiveEntry } from './archive.ts';
import { ChatError } from './chats.ts';

/**
 * Installing a reviewed skill, at the user's request and never otherwise. This is the one
 * place the guild writes outside its own data folder, so it is strict:
 *
 * - It fetches exactly the commit the Reviewer read, and checks it got that commit.
 * - It copies only the skill's own folder, which must hold a SKILL.md, into the skills
 *   folder under the skill's name, and never over a skill already there.
 * - It refuses symbolic links (which could point anywhere on the disk) and anything
 *   larger than a skill has reason to be.
 * - It runs no code from the repository: no hooks, no install scripts, no submodules.
 */

export interface InstallOptions {
  /** Where installed skills live: ~/.claude/skills. */
  skillsDir: string;
  /**
   * Where repositories are fetched from, "<base><owner>/<repo>.git". GitHub, unless tests
   * point it at local repositories.
   */
  gitBase?: string;
}

const MAX_BYTES = 5 * 1024 * 1024;
const MAX_FILES = 500;

function git(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      // No hooks and no credential prompts: fetching a stranger's repository runs nothing.
      ['-c', 'core.hooksPath=/dev/null', '-c', 'credential.helper=', ...args],
      {
        cwd,
        timeout: 120_000,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
        maxBuffer: 4 * 1024 * 1024,
      },
      (err, stdout, stderr) =>
        err ? reject(new Error(String(stderr || err.message).trim())) : resolve(stdout),
    );
  });
}

/** Every file under `dir`, refusing links and stopping at the size and count limits. */
async function checkTree(dir: string): Promise<void> {
  let bytes = 0;
  let files = 0;
  const walk = async (d: string) => {
    for (const e of await readdir(d, { withFileTypes: true })) {
      const full = join(d, e.name);
      const info = await lstat(full);
      if (info.isSymbolicLink())
        throw new ChatError(422, `The skill contains a symbolic link (${e.name}); not installed.`);
      if (info.isDirectory()) {
        if (e.name === '.git') continue;
        await walk(full);
      } else if (info.isFile()) {
        bytes += info.size;
        files += 1;
        if (bytes > MAX_BYTES || files > MAX_FILES)
          throw new ChatError(422, 'The skill is too large to be a skill; not installed.');
      }
    }
  };
  await walk(dir);
}

/** Install `entry` at its pinned commit. Returns the folder it was installed to. */
export async function installSkill(entry: ArchiveEntry, opts: InstallOptions): Promise<string> {
  const dest = join(opts.skillsDir, entry.name);
  if (
    await stat(dest).then(
      () => true,
      () => false,
    )
  ) {
    throw new ChatError(409, `A skill called "${entry.name}" is already installed; not replaced.`);
  }
  const work = await mkdtemp(join(tmpdir(), 'guild-skill-'));
  try {
    const url = `${opts.gitBase ?? 'https://github.com/'}${entry.repo}.git`;
    await git(work, ['init', '--quiet']);
    await git(work, ['remote', 'add', 'origin', url]);
    try {
      await git(work, ['fetch', '--quiet', '--depth', '1', 'origin', entry.commit]);
    } catch (err) {
      throw new ChatError(
        502,
        `Could not fetch ${entry.repo} at ${entry.commit.slice(0, 7)}: ${(err as Error).message}`,
      );
    }
    await git(work, ['-c', 'advice.detachedHead=false', 'checkout', '--quiet', 'FETCH_HEAD']);
    const head = (await git(work, ['rev-parse', 'HEAD'])).trim();
    if (head !== entry.commit)
      throw new ChatError(502, 'Fetched a different commit from the one reviewed; not installed.');

    const source = entry.path ? join(work, entry.path) : work;
    if (
      !(await stat(join(source, 'SKILL.md')).then(
        (s) => s.isFile(),
        () => false,
      ))
    ) {
      throw new ChatError(
        422,
        `No SKILL.md in ${entry.path || 'the repository root'} at that commit; not installed.`,
      );
    }
    await checkTree(source);
    await mkdir(opts.skillsDir, { recursive: true });
    await cp(source, dest, {
      recursive: true,
      errorOnExist: true,
      force: false,
      filter: (src) => !src.split(/[\\/]/).includes('.git'),
    });
    return dest;
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}
