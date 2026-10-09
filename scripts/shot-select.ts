/**
 * Picks the screenshots a pull request's comment shows: those for the areas its changed
 * files belong to (web/e2e/shot-areas.ts), in every theme only when a theme file changed.
 *
 *   node scripts/shot-select.ts <shots dir> <out dir> <changed-files.txt> [--all]
 *
 * copies the chosen PNGs into <out dir> and writes <out dir>/header.md, the lines that
 * open the comment. `--all` (the PR's "screenshots: all" label) chooses everything.
 */
import { copyFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { AREAS, SHARED, THEME_FILES } from '../web/e2e/shot-areas.ts';
import { DEFAULT_THEME } from '../web/src/themes.ts';

export const ALL_LABEL = 'screenshots: all';

export interface Selection {
  /** The shot names to show, e.g. `10-chat`. */
  shots: string[];
  /** Every theme, or only the default one. */
  themes: 'all' | 'default';
  /** Why each part was chosen, for the comment's header. */
  reasons: string[];
  /** Areas with shots that were left out. */
  skipped: string[];
}

/** `dir/` matches anything under it; anything else matches only that path. */
export const matches = (path: string, pattern: string) =>
  pattern.endsWith('/') ? path.startsWith(pattern) : path === pattern;

const inList = (path: string, list: readonly string[]) => list.some((p) => matches(path, p));

/** Files that never change a screen: unit tests and prose. */
const quiet = (path: string) => /\.test\.tsx?$/.test(path) || /\.md$/.test(path);

/** The shot names a spec file takes, read from its `shoot(…, '<name>'…)` and `capture(…)` calls. */
export function shotsInSpec(source: string): string[] {
  return [...source.matchAll(/\b(?:shoot|capture)\([^;]*?'(\d+-[a-z0-9-]+)'/g)].map((m) => m[1]!);
}

export function selectShots(options: {
  changed: readonly string[];
  allShots: readonly string[];
  /** Spec file path → the shots it takes, so a changed spec shows its own shots. */
  specShots?: ReadonlyMap<string, readonly string[]>;
  forceAll?: boolean;
}): Selection {
  const { allShots, specShots = new Map(), forceAll = false } = options;
  const changed = options.changed.filter((p) => !quiet(p));
  const themes = forceAll || changed.some((p) => inList(p, THEME_FILES)) ? 'all' : 'default';
  const everything = (reason: string): Selection => ({
    shots: [...allShots],
    themes,
    reasons: [reason],
    skipped: [],
  });

  if (forceAll) return everything(`the "${ALL_LABEL}" label`);
  const shared = changed.find((p) => inList(p, SHARED));
  if (shared) return everything(`${shared} is shared by every screen`);
  const mapped = (p: string) =>
    inList(p, THEME_FILES) || AREAS.some((a) => inList(p, a.files)) || specShots.has(p);
  const unmapped = changed.find((p) => p.startsWith('web/src/') && !mapped(p));
  if (unmapped) return everything(`${unmapped} is in no area yet`);

  const chosen = new Set<string>();
  const reasons: string[] = [];
  for (const area of AREAS) {
    const hit = changed.find((p) => inList(p, area.files));
    if (!hit) continue;
    area.shots.forEach((s) => chosen.add(s));
    reasons.push(`${area.name} (${hit})`);
  }
  for (const path of changed) {
    const own = specShots.get(path);
    if (!own?.length) continue;
    own.forEach((s) => chosen.add(s));
    reasons.push(`the shots ${path} takes`);
  }
  if (themes === 'all') {
    const hit = changed.find((p) => inList(p, THEME_FILES))!;
    reasons.push(`every theme (${hit})`);
  }
  const shots = allShots.filter((s) => chosen.has(s));
  const skipped = AREAS.filter((a) => !a.shots.some((s) => chosen.has(s))).map((a) => a.name);
  return { shots, themes, reasons, skipped };
}

/** The lines that open the PR comment. */
export function header(selection: Selection, total: number, sha: string, artifactUrl?: string): string {
  const full = artifactUrl ? `[the run's download](${artifactUrl})` : "the run's download";
  const n = selection.shots.length;
  const lines = [`From the browser tests on ${sha}.`, ''];
  if (n === 0) {
    lines.push(`No screens changed in this PR. All ${total} shots are in ${full}.`);
  } else {
    const which = n === total ? `All ${total} shots` : `${n} of ${total} shots`;
    const look =
      selection.themes === 'all'
        ? 'in every theme, side by side'
        : 'in the default theme (every theme shows when a theme file changes)';
    lines.push(`${which}, ${look}, for ${selection.reasons.join(', ')}. Click one for full size.`);
    if (selection.skipped.length) {
      lines.push(
        '',
        `<details><summary>Left out: ${selection.skipped.join(', ')}</summary>\n\n` +
          `Their screens did not change. Every shot is in ${full}, or add the "${ALL_LABEL}" label to show them here.\n\n</details>`,
      );
    }
  }
  return `${lines.join('\n')}\n`;
}

/** `10-chat--hazard.png` → `{shot: '10-chat', theme: 'hazard'}`. */
const parse = (file: string) => {
  const [shot = '', theme = ''] = file.replace(/\.png$/, '').split('--');
  return { shot, theme };
};

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const [shotsDir, outDir, changedFile] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  if (!shotsDir || !outDir || !changedFile) {
    console.error('usage: node scripts/shot-select.ts <shots dir> <out dir> <changed-files.txt> [--all]');
    process.exit(2);
  }
  const files = readdirSync(shotsDir).filter((f) => f.endsWith('.png'));
  const allShots = [...new Set(files.map((f) => parse(f).shot))];
  const specs = readdirSync('web/e2e').filter((f) => f.endsWith('.ts'));
  const specShots = new Map(
    specs.map((f) => [`web/e2e/${f}`, shotsInSpec(readFileSync(join('web/e2e', f), 'utf8'))] as const),
  );
  const changed = readFileSync(changedFile, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const selection = selectShots({ changed, allShots, specShots, forceAll: process.argv.includes('--all') });
  mkdirSync(outDir, { recursive: true });
  const keep = new Set(selection.shots);
  for (const file of files) {
    const { shot, theme } = parse(file);
    if (!keep.has(shot)) continue;
    if (selection.themes === 'default' && theme && theme !== DEFAULT_THEME) continue;
    copyFileSync(join(shotsDir, file), join(outDir, file));
  }
  const sha = process.env.SHA ?? '';
  writeFileSync(join(outDir, 'header.md'), header(selection, allShots.length, sha, process.env.ARTIFACT_URL));
  console.log(
    `${selection.shots.length} of ${allShots.length} shots, ${selection.themes === 'all' ? 'every theme' : 'the default theme'}`,
  );
}
