/**
 * Which modules a change reaches: the import graph of core/, server/ and web/, read from
 * the source with no build. `dependents(graph, file)` is every module that imports the
 * file, directly or through others. `@agent-guild/core` is followed name by name, so a
 * change to one core function reaches only the modules that use it (or its file).
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';

/** Folders whose modules make up the graph. Paths are repo-relative with `/`. */
export const SOURCE_DIRS = ['core/src', 'server/src', 'web/src'];
const CORE_INDEX = 'core/src/index.ts';

export interface Import {
  from: string;
  /**
   * The runtime names taken (types left out), or null for all of them (`*`, a default, a
   * side-effect import). Empty when only types were taken.
   */
  names: string[] | null;
}

/** Every `import … from`, `export … from`, bare `import '…'` and `import('…')` in `source`. */
export function parseImports(source: string): Import[] {
  const found: Import[] = [];
  const statement = /\b(?:import|export)\s+([^'"]*?)\s+from\s+['"]([^'"]+)['"]/g;
  for (const [, clause = '', from = ''] of source.matchAll(statement)) {
    found.push({ from, names: namesIn(clause) });
  }
  for (const [, from = ''] of source.matchAll(/\bimport\s*\(?\s*['"]([^'"]+)['"]/g)) {
    found.push({ from, names: null });
  }
  return found;
}

/**
 * `{ a, type B, c as d }` → `['a', 'c']`; `type { … }` → `[]`; anything else (a default,
 * `* as x`) → null. Types leave the built code, so a change to one never reaches a screen
 * by itself: the code that must change with it is in the same diff.
 */
function namesIn(clause: string): string[] | null {
  if (/^type\s/.test(clause)) return [];
  const braces = clause.match(/^\{([^}]*)\}$/s);
  if (!braces) return null;
  return braces[1]!
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part && !/^type\s/.test(part))
    .map((part) => part.split(/\s+as\s+/)[0]!.trim());
}

/** The names a module declares with `export`. */
export function exportsOf(source: string): Set<string> {
  const names = new Set<string>();
  const declared =
    /\bexport\s+(?:declare\s+)?(?:default\s+)?(?:async\s+)?(?:abstract\s+)?(?:function\*?|const|let|var|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/g;
  for (const [, name] of source.matchAll(declared)) names.add(name!);
  for (const [, list = ''] of source.matchAll(/\bexport\s+(?:type\s+)?\{([^}]*)\}(?!\s*from)/g)) {
    for (const part of list.split(',')) {
      const name = part
        .trim()
        .split(/\s+as\s+/)
        .pop()
        ?.trim();
      if (name) names.add(name);
    }
  }
  return names;
}

/** Module → the modules it imports. */
export type Graph = Map<string, Set<string>>;

/** Build the graph from source texts keyed by repo-relative path. */
export function buildGraph(sources: ReadonlyMap<string, string>): Graph {
  const resolve = (file: string, spec: string) => {
    if (spec === '@agent-guild/core') return CORE_INDEX;
    if (!spec.startsWith('.')) return null; // a package
    const path = normalize(join(dirname(file), spec)).replaceAll('\\', '/');
    return sources.has(path) ? path : null;
  };
  // core's index re-exports its files; a named import goes to the file that declares it.
  const barrel = [...parseImports(sources.get(CORE_INDEX) ?? '')]
    .map((i) => resolve(CORE_INDEX, i.from))
    .filter((p): p is string => p !== null);
  const declares = new Map(barrel.map((p) => [p, exportsOf(sources.get(p) ?? '')] as const));

  const graph: Graph = new Map();
  for (const [file, source] of sources) {
    const deps = new Set<string>();
    for (const { from, names } of parseImports(source)) {
      const target = resolve(file, from);
      if (!target || names?.length === 0) continue;
      if (target !== CORE_INDEX || file === CORE_INDEX) {
        deps.add(target);
        continue;
      }
      // Through the barrel: only the files that declare what was taken.
      const homes = names?.map((n) => barrel.filter((p) => declares.get(p)?.has(n)));
      // A name no file declares (parsing missed it): depend on all of core, to be safe.
      if (!homes || homes.some((h) => h.length === 0)) {
        barrel.forEach((p) => deps.add(p));
      } else {
        homes.flat().forEach((p) => deps.add(p));
      }
    }
    graph.set(file, deps);
  }
  return graph;
}

/** Every module that imports `file`, directly or through others. */
export function dependents(graph: Graph, file: string): Set<string> {
  const importers = new Map<string, string[]>();
  for (const [from, deps] of graph) {
    for (const dep of deps) importers.set(dep, [...(importers.get(dep) ?? []), from]);
  }
  const seen = new Set<string>();
  const queue = [file];
  while (queue.length) {
    for (const next of importers.get(queue.pop()!) ?? []) {
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return seen;
}

/** Whether `path` is a module the graph reads: a non-test .ts or .tsx file in SOURCE_DIRS. */
export const isModule = (path: string) =>
  SOURCE_DIRS.some((d) => path.startsWith(`${d}/`)) && /\.tsx?$/.test(path) && !/\.test\.tsx?$/.test(path);

/** The graph of this repository, read from disk (run from the repo root). */
export function repoGraph(root = '.'): Graph {
  const sources = new Map<string, string>();
  for (const dir of SOURCE_DIRS) {
    for (const name of readdirSync(join(root, dir))) {
      const path = `${dir}/${name}`;
      if (isModule(path)) sources.set(path, readFileSync(join(root, path), 'utf8'));
    }
  }
  return buildGraph(sources);
}
