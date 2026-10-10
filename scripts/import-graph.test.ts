import { describe, expect, it } from 'vitest';

import { buildGraph, dependents, exportsOf, isModule, parseImports } from './import-graph.ts';

describe('parseImports', () => {
  it('reads named, default, side-effect, re-export and dynamic imports', () => {
    const src = [
      "import { a, type B, c as d } from './one.ts';",
      "import React from 'react';",
      "import './styles.css';",
      "export * from './two.ts';",
      "const lazy = import('./three.tsx');",
      'import {\n  e,\n  f,\n} from "./four.ts";',
    ].join('\n');
    expect(parseImports(src)).toEqual([
      { from: './one.ts', names: ['a', 'c'] },
      { from: 'react', names: null },
      { from: './two.ts', names: null },
      { from: './four.ts', names: ['e', 'f'] },
      { from: './styles.css', names: null },
      { from: './three.tsx', names: null },
    ]);
  });

  it('takes nothing at runtime from a type-only import', () => {
    expect(parseImports("import type { A, B } from './x.ts';")).toEqual([{ from: './x.ts', names: [] }]);
    expect(parseImports("import { type A } from './x.ts';")).toEqual([{ from: './x.ts', names: [] }]);
  });
});

describe('exportsOf', () => {
  it('finds declared and listed exports', () => {
    const src = [
      'export function rankOf() {}',
      'export const LOCATIONS = [];',
      'export type Rank = string;',
      'export interface Hero {}',
      'export async function load() {}',
      'const x = 1; export { x as renamed };',
    ].join('\n');
    expect([...exportsOf(src)].sort()).toEqual(['Hero', 'LOCATIONS', 'Rank', 'load', 'rankOf', 'renamed']);
  });
});

describe('buildGraph and dependents', () => {
  const sources = new Map([
    ['core/src/index.ts', "export * from './game.ts';\nexport * from './chat.ts';"],
    ['core/src/game.ts', 'export function rankOf() {}\nexport type Hero = {};'],
    ['core/src/chat.ts', 'export function emptyChat() {}'],
    ['web/src/format.ts', 'export const ago = 1;'],
    ['web/src/panels.tsx', "import { ago } from './format.ts';\nimport { rankOf } from '@agent-guild/core';"],
    ['web/src/chat.tsx', "import { emptyChat, type Hero } from '@agent-guild/core';"],
    [
      'web/src/forge.tsx',
      "import { Panel } from './panels.tsx';\nimport type { Hero } from '@agent-guild/core';",
    ],
    ['web/src/App.tsx', "import './chat.tsx';\nimport { Forge } from './forge.tsx';"],
  ]);
  const graph = buildGraph(sources);

  it('follows relative imports up to every importer', () => {
    expect([...dependents(graph, 'web/src/format.ts')].sort()).toEqual([
      'web/src/App.tsx',
      'web/src/forge.tsx',
      'web/src/panels.tsx',
    ]);
  });

  it('follows the core package name by name to the file that declares it', () => {
    // The index itself re-exports both files.
    expect([...dependents(graph, 'core/src/game.ts')].sort()).toEqual([
      'core/src/index.ts',
      'web/src/App.tsx',
      'web/src/forge.tsx',
      'web/src/panels.tsx',
    ]);
    expect([...dependents(graph, 'core/src/chat.ts')].sort()).toEqual([
      'core/src/index.ts',
      'web/src/App.tsx',
      'web/src/chat.tsx',
    ]);
  });

  it('depends on all of core when a name is not found', () => {
    const g = buildGraph(
      new Map([...sources, ['web/src/x.ts', "import { unknown } from '@agent-guild/core';"]]),
    );
    expect(dependents(g, 'core/src/chat.ts').has('web/src/x.ts')).toBe(true);
    expect(dependents(g, 'core/src/game.ts').has('web/src/x.ts')).toBe(true);
  });
});

describe('isModule', () => {
  it('takes source files and leaves tests, styles and other folders', () => {
    expect(isModule('web/src/chat.tsx')).toBe(true);
    expect(isModule('server/src/forge.ts')).toBe(true);
    expect(isModule('web/src/chat.test.ts')).toBe(false);
    expect(isModule('web/src/styles.css')).toBe(false);
    expect(isModule('web/e2e/shots.ts')).toBe(false);
  });
});
