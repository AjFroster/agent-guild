#!/usr/bin/env node
// Builds a stand-in for a GitHub repository holding one skill, for the librarians' browser
// test: <dir>/acme-labs/agent-skills.git, a bare repository the installer can fetch a
// commit from like it would from GitHub. Fictional names only.
//
//   node make-skill-repo.mjs <dir>

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = process.argv[2];
const git = (cwd, ...args) =>
  execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...args], {
    cwd,
    stdio: 'pipe',
  });

const work = mkdtempSync(join(tmpdir(), 'skill-repo-'));
git(work, 'init', '-q', '-b', 'main');
mkdirSync(join(work, 'skills', 'csv-wrangler'), { recursive: true });
writeFileSync(
  join(work, 'skills', 'csv-wrangler', 'SKILL.md'),
  '---\nname: csv-wrangler\ndescription: Clean, join and summarise CSV files.\n---\n\n# CSV wrangler\n\nA test skill.\n',
);
mkdirSync(join(work, 'skills', 'md-tables'), { recursive: true });
writeFileSync(
  join(work, 'skills', 'md-tables', 'SKILL.md'),
  '---\nname: md-tables\ndescription: Format Markdown tables.\n---\n\n# Markdown tables\n\nA test skill.\n',
);
writeFileSync(join(work, 'README.md'), '# Agent skills (test)\n');
git(work, 'add', '-A');
git(work, 'commit', '-q', '-m', 'Add two skills');

const bare = join(dir, 'acme-labs', 'agent-skills.git');
rmSync(bare, { recursive: true, force: true });
mkdirSync(join(dir, 'acme-labs'), { recursive: true });
git(dir, 'clone', '-q', '--bare', work, bare);
// GitHub lets a client fetch a commit by its hash; a local bare repository must be told to.
git(bare, 'config', 'uploadpack.allowAnySHA1InWant', 'true');
rmSync(work, { recursive: true, force: true });
