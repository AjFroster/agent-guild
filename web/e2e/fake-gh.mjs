#!/usr/bin/env node
// A stand-in for `gh`, used only by the browser tests: `gh pr list ...` prints the pull
// requests a test wrote to $FAKE_GH_DIR/<repository folder name>.json, or none. Anything
// else fails, as gh would without a login.
import { readFileSync } from 'node:fs';
import { basename, join } from 'node:path';

const [cmd, sub] = process.argv.slice(2);
if (cmd !== 'pr' || sub !== 'list' || !process.env.FAKE_GH_DIR) {
  process.stderr.write('fake gh: only `pr list` is faked\n');
  process.exit(1);
}
let prs = '[]';
try {
  prs = readFileSync(join(process.env.FAKE_GH_DIR, `${basename(process.cwd())}.json`), 'utf8');
} catch {
  // No pull requests for this repository yet.
}
process.stdout.write(prs);
