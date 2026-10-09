/**
 * Picks the screenshots a pull request takes and shows. Each changed module is followed
 * through the import graph (scripts/import-graph.ts) to the areas whose screens use it
 * (web/e2e/shot-areas.ts); other files match an area by path. Every theme is taken only
 * when a theme file changed.
 *
 *   node scripts/shot-select.ts plan <changed-files.txt> <out dir> [--all]
 *
 * runs before the browser tests: it writes <out dir>/plan.env (GUILD_SHOTS and
 * GUILD_SHOT_THEMES, which web/e2e/shots.ts obeys, so only the chosen shots are taken) and
 * <out dir>/plan.json.
 *
 *   node scripts/shot-select.ts header <out dir>
 *
 * runs after them and writes <out dir>/header.md, the lines that open the PR comment.
 * `--all` (the PR's "screenshots: all" label) chooses everything.
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { AREAS, SHARED, THEME_FILES } from '../web/e2e/shot-areas.ts';
import { type Graph, dependents, isModule, repoGraph } from './import-graph.ts';

export const ALL_LABEL = 'screenshots: all';

export interface Selection {
  /** The shot names to take and show, e.g. `10-chat`. */
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
  /** The import graph, to follow a changed module to the screens that use it. */
  graph?: Graph;
  /** Spec file path → the shots it takes, so a changed spec shows its own shots. */
  specShots?: ReadonlyMap<string, readonly string[]>;
  forceAll?: boolean;
}): Selection {
  const { allShots, graph = new Map(), specShots = new Map(), forceAll = false } = options;
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
  if (shared) return everything(`every screen (${shared} is shared by all of them)`);

  // Area → why it was chosen, e.g. "Forge (web/src/format.ts, used by health.tsx)".
  const hits = new Map<string, string>();
  for (const path of changed) {
    const reached = new Set([path, ...(isModule(path) ? dependents(graph, path) : [])]);
    let placed = false;
    for (const area of AREAS) {
      const via = area.modules.includes(path) ? path : area.modules.find((m) => reached.has(m));
      if (!via && !inList(path, area.files)) continue;
      placed = true;
      if (hits.has(area.name)) continue;
      const how = !via || via === path ? path : `${path}, used by ${basename(via)}`;
      hits.set(area.name, `${area.name} (${how})`);
    }
    // A screen module no area uses yet (a new page): show everything rather than nothing.
    if (!placed && path.startsWith('web/src/') && !inList(path, THEME_FILES)) {
      return everything(`every screen (${path} is in no area yet)`);
    }
  }

  const chosen = new Set<string>();
  const reasons: string[] = [];
  for (const area of AREAS) {
    const why = hits.get(area.name);
    if (!why) continue;
    area.shots.forEach((s) => chosen.add(s));
    reasons.push(why);
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
  const download = artifactUrl ? `[the run's download](${artifactUrl})` : "the run's download";
  const n = selection.shots.length;
  const lines = [`From the browser tests on ${sha}.`, ''];
  if (n === 0) {
    lines.push(
      `No screen this PR changes has a shot, so none were taken. Add the "${ALL_LABEL}" label to take all ${total}.`,
    );
  } else {
    const which = n === total ? `All ${total} shots` : `${n} of ${total} shots`;
    const look =
      selection.themes === 'all'
        ? 'in every theme, side by side'
        : 'in the default theme (every theme is taken when a theme file changes)';
    lines.push(`${which}, ${look}, for ${selection.reasons.join(', ')}. Click one for full size.`);
    if (selection.skipped.length) {
      lines.push(
        '',
        `<details><summary>Not taken: ${selection.skipped.join(', ')}</summary>\n\n` +
          `No file this PR changes reaches their screens, so they were not taken. Add the "${ALL_LABEL}" label to take every shot.\n\n</details>`,
      );
    }
  }
  if (n) lines.push('', `Also in ${download}.`);
  return `${lines.join('\n')}\n`;
}

/** Every shot the browser specs take, keyed by spec path. */
export function repoSpecShots(dir = 'web/e2e'): Map<string, string[]> {
  const specs = readdirSync(dir).filter((f) => f.endsWith('.ts'));
  return new Map(specs.map((f) => [`${dir}/${f}`, shotsInSpec(readFileSync(join(dir, f), 'utf8'))]));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const [command, ...rest] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const usage = () => {
    console.error(
      'usage: node scripts/shot-select.ts plan <changed-files.txt> <out dir> [--all]\n' +
        '       node scripts/shot-select.ts header <out dir>',
    );
    process.exit(2);
  };
  const specShots = repoSpecShots();
  const allShots = [...new Set([...specShots.values()].flat())];
  if (command === 'plan') {
    const [changedFile, outDir] = rest;
    if (!changedFile || !outDir) usage();
    const changed = readFileSync(changedFile!, 'utf8')
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    const selection = selectShots({
      changed,
      allShots,
      graph: repoGraph(),
      specShots,
      forceAll: process.argv.includes('--all'),
    });
    mkdirSync(outDir!, { recursive: true });
    writeFileSync(join(outDir!, 'plan.json'), JSON.stringify(selection, null, 2));
    writeFileSync(
      join(outDir!, 'plan.env'),
      `GUILD_SHOTS=${selection.shots.join(',')}\nGUILD_SHOT_THEMES=${selection.themes}\n`,
    );
    console.log(
      `${selection.shots.length} of ${allShots.length} shots, ${selection.themes === 'all' ? 'every theme' : 'the default theme'}: ${selection.reasons.join(', ') || 'none'}`,
    );
  } else if (command === 'header') {
    const [outDir] = rest;
    if (!outDir) usage();
    const selection = JSON.parse(readFileSync(join(outDir!, 'plan.json'), 'utf8')) as Selection;
    writeFileSync(
      join(outDir!, 'header.md'),
      header(selection, allShots.length, process.env.SHA ?? '', process.env.ARTIFACT_URL),
    );
  } else {
    usage();
  }
}
