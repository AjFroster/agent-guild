/**
 * Lays out the browser tests' screenshots for the PR comment and the run summary: one
 * section per shot, with its themes side by side in a table (control-room first, the
 * order of THEMES), so a change can be compared across themes at a glance.
 *
 *   node scripts/shot-table.ts <screenshot dir> <base url>
 *
 * Files are named `<order>-<name>--<theme>.png` by web/e2e/shots.ts; a file without a
 * theme suffix gets a section to itself.
 */
import { readdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

import { THEMES } from '../web/src/themes.ts';

const label = (shot: string) => shot.replace(/^[0-9]+-/, '').replace(/-/g, ' ');

/** Numbered shots in number order (2 before 10), then the rest by name. */
function byOrder(a: string, b: string): number {
  const na = parseInt(a, 10);
  const nb = parseInt(b, 10);
  if (!Number.isNaN(na) && !Number.isNaN(nb) && na !== nb) return na - nb;
  return a.localeCompare(b);
}

export function shotTable(files: readonly string[], base: string): string {
  const shots = new Map<string, Map<string, string>>();
  for (const file of files) {
    if (!file.endsWith('.png')) continue;
    const [shot = '', theme = ''] = file.slice(0, -'.png'.length).split('--');
    if (!shots.has(shot)) shots.set(shot, new Map());
    shots.get(shot)!.set(theme, file);
  }
  const known = THEMES.map((t) => t.id as string);
  const sections: string[] = [];
  for (const shot of [...shots.keys()].sort(byOrder)) {
    const byTheme = shots.get(shot)!;
    const name = label(shot);
    const themes = [...byTheme.keys()].sort((a, b) => {
      const ia = known.indexOf(a);
      const ib = known.indexOf(b);
      return (ia < 0 ? known.length : ia) - (ib < 0 ? known.length : ib) || a.localeCompare(b);
    });
    const cell = (theme: string) => {
      const url = `${base}/${byTheme.get(theme)!}`;
      const alt = theme ? `${name}, ${theme}` : name;
      return `[![${alt}](${url})](${url})`;
    };
    const title = (theme: string) => THEMES.find((t) => t.id === theme)?.name ?? (theme || name);
    const body =
      themes.length === 1 && themes[0] === ''
        ? cell('')
        : [
            `| ${themes.map(title).join(' | ')} |`,
            `| ${themes.map(() => '---').join(' | ')} |`,
            `| ${themes.map(cell).join(' | ')} |`,
          ].join('\n');
    sections.push(`<details open><summary>${name}</summary>\n\n${body}\n\n</details>`);
  }
  return sections.join('\n');
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const [dir, base] = process.argv.slice(2);
  if (!dir || !base) {
    console.error('usage: node scripts/shot-table.ts <screenshot dir> <base url>');
    process.exit(2);
  }
  console.log(shotTable(readdirSync(dir), base));
}
