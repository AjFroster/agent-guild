import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Type-checks the Herald against the plugin API that Claude Code lays beside a mod it has
// loaded. That file is Claude Code's own and is not committed, so where it is missing (CI,
// a fresh clone) the check is skipped with a note; `claude --plugin-dir mod` lays it.
const api = fileURLToPath(new URL('../../mod/.claude-plugin/types/claude-code/index.d.ts', import.meta.url));
if (!existsSync(api)) {
  console.log(
    'mod type-check skipped: load the mod once with `claude --plugin-dir mod` to lay its API types.',
  );
} else {
  execFileSync('npx', ['tsc', '-p', fileURLToPath(new URL('.', import.meta.url))], { stdio: 'inherit' });
}
