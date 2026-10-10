import { describe, expect, it } from 'vitest';

import { shotTable } from './shot-table.ts';

const BASE = 'https://example.test/pr-1/abc1234';

describe('shotTable', () => {
  it('puts every theme of a shot side by side, Control Room first', () => {
    const md = shotTable(
      ['10-chat--hazard.png', '10-chat--classic.png', '10-chat--control-room.png', '10-chat--telemetry.png'],
      BASE,
    );
    expect(md).toContain('<summary>chat</summary>');
    expect(md).toContain('| Control Room | Telemetry | Hazard | Classic |');
    expect(md).toContain('| --- | --- | --- | --- |');
    const row = md.split('\n').find((l) => l.startsWith('| [!['))!;
    const order = [...row.matchAll(/10-chat--([a-z-]+)\.png\)\]/g)].map((m) => m[1]);
    expect(order).toEqual(['control-room', 'telemetry', 'hazard', 'classic']);
    expect(row).toContain(
      `[![chat, control-room](${BASE}/10-chat--control-room.png)](${BASE}/10-chat--control-room.png)`,
    );
  });

  it('orders shots by their number, so 2 comes before 10', () => {
    const md = shotTable(
      ['10-chat--classic.png', '2-hero-at-forge--classic.png', '1-empty-guild--classic.png'],
      BASE,
    );
    const names = [...md.matchAll(/<summary>([^<]+)<\/summary>/g)].map((m) => m[1]);
    expect(names).toEqual(['empty guild', 'hero at forge', 'chat']);
  });

  it('shows a shot without a theme on its own, and ignores other files', () => {
    const md = shotTable(['5-plain.png', 'notes.txt'], BASE);
    expect(md).toBe(
      `<details open><summary>plain</summary>\n\n[![plain](${BASE}/5-plain.png)](${BASE}/5-plain.png)\n\n</details>`,
    );
  });

  it('gives nothing for no screenshots', () => {
    expect(shotTable([], BASE)).toBe('');
  });
});
