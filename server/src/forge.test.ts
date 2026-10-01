import { EventEmitter } from 'node:events';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ChatManager, type ChildLike } from './chats.ts';
import { Forge, ForgeStore, checkPiece, frontmatterName, installPiece } from './forge.ts';

const SKILL =
  '---\nname: release-notes\ndescription: Write release notes the way this project does.\n---\n\n# Release notes\n';
const skillPiece = (id: string) => ({
  id,
  name: 'release-notes',
  description: 'Write release notes the way this project does.',
  files: [
    { path: 'SKILL.md', content: SKILL },
    { path: 'scripts/changes.sh', content: 'git log --oneline "$1"..HEAD\n' },
  ],
});

let home: string;
let project: string;
beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'guild-forge-'));
  project = join(home, 'shop');
  await mkdir(project);
});
afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

describe('a forged piece', () => {
  it('is checked before it can be hung on the rack', () => {
    expect(frontmatterName(SKILL)).toBe('release-notes');
    expect(checkPiece('skill', skillPiece('x')).files.map((f) => f.path)).toEqual([
      'SKILL.md',
      'scripts/changes.sh',
    ]);
    expect(() =>
      checkPiece('skill', { ...skillPiece('x'), files: [{ path: 'README.md', content: 'x' }] }),
    ).toThrow('SKILL.md');
    expect(() => checkPiece('skill', { ...skillPiece('x'), name: 'other-name' })).toThrow('name: other-name');
    for (const path of ['../evil.sh', '/etc/passwd', 'a/../../b', 'scripts//x'])
      expect(() =>
        checkPiece('skill', { ...skillPiece('x'), files: [...skillPiece('x').files, { path, content: '' }] }),
      ).toThrow('plain relative path');
    expect(() =>
      checkPiece('command', { id: 'x', name: 'ship', files: [{ path: 'other.md', content: 'x' }] }),
    ).toThrow('ship.md');
    expect(
      checkPiece('command', { id: 'x', name: 'ship', files: [{ path: 'ship.md', content: 'Ship it.' }] })
        .name,
    ).toBe('ship');
  });
});

describe('ForgeStore', () => {
  it('takes an order, a piece only while it is on the anvil, then a review', async () => {
    const store = new ForgeStore(join(home, 'forge.json'), () => 100);
    const order = await store.addOrder({
      project,
      kind: 'skill',
      need: 'Write release notes like we do.',
      requestedBy: 'Percival',
    });
    expect(order.status).toBe('requested');
    await expect(store.submitPiece(skillPiece(order.id))).rejects.toThrow('not on the anvil');
    await store.update(order.id, (o) => {
      o.status = 'forging';
    });
    expect((await store.submitPiece(skillPiece(order.id))).status).toBe('forged');
    await expect(store.recordReview({ id: order.id, verdict: 'great', reason: 'x' })).rejects.toThrow(
      'verdict',
    );
    const reviewed = await store.recordReview({
      id: order.id,
      verdict: 'ready',
      reason: 'Does what was asked.',
    });
    expect(reviewed.status).toBe('reviewed');
    expect(reviewed.review).toMatchObject({ verdict: 'ready', reviewedAt: 100 });
    await expect(store.addOrder({ project, kind: 'hook', need: 'Something long enough.' })).rejects.toThrow(
      'kind',
    );
    expect((await stat(join(home, 'forge.json'))).mode & 0o777).toBe(0o600);
  });
});

describe('installPiece', () => {
  it("writes exactly the reviewed files into the project's .claude, never over anything", async () => {
    const order = {
      id: 'a',
      project,
      kind: 'skill' as const,
      piece: { ...checkPiece('skill', skillPiece('a')), forgedAt: 1 },
    };
    const dest = await installPiece(order as never);
    expect(dest).toBe(join(project, '.claude', 'skills', 'release-notes'));
    expect(await readFile(join(dest, 'SKILL.md'), 'utf8')).toBe(SKILL);
    expect(await readFile(join(dest, 'scripts', 'changes.sh'), 'utf8')).toContain('git log');
    await expect(installPiece(order as never)).rejects.toThrow('already exists');

    const command = {
      id: 'b',
      project,
      kind: 'command' as const,
      piece: {
        name: 'ship',
        description: '',
        files: [{ path: 'ship.md', content: 'Ship it.' }],
        forgedAt: 1,
      },
    };
    expect(await installPiece(command as never)).toBe(join(project, '.claude', 'commands', 'ship.md'));
    await writeFile(join(project, '.claude', 'commands', 'other.md'), 'mine');
    await expect(
      installPiece({
        ...command,
        piece: { ...command.piece, name: 'other', files: [{ path: 'other.md', content: 'x' }] },
      } as never),
    ).rejects.toThrow('already exists');
    expect(await readFile(join(project, '.claude', 'commands', 'other.md'), 'utf8')).toBe('mine');
  });
});

/**
 * A `claude -p` stand-in: on each turn it plays its role through `act`, as the real CLI
 * would through the guild's MCP tools, then ends the turn.
 */
class FakeChild extends EventEmitter {
  stdin = new PassThrough();
  stdout = new PassThrough();
  stderr = new PassThrough();
  readonly args: string[];
  constructor(args: string[], act: (role: string) => Promise<void>) {
    super();
    this.args = args;
    this.stdin.on('data', () => {
      void (async () => {
        const config = JSON.parse(
          await readFile(this.args[this.args.indexOf('--mcp-config') + 1]!, 'utf8'),
        ) as {
          mcpServers: { guild: { env: { GUILD_ROLE: string } } };
        };
        await act(config.mcpServers.guild.env.GUILD_ROLE);
        this.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', result: 'done' }) + '\n');
      })();
    });
  }
  kill() {
    setImmediate(() => this.emit('exit', 130));
    return true;
  }
}

function forgeWith(act: (role: string, store: ForgeStore) => Promise<void>) {
  const store = new ForgeStore(join(home, '.agent-guild', 'forge.json'));
  const children: FakeChild[] = [];
  const chats = new ChatManager({
    claude: 'claude',
    home,
    spawn: (_cmd, args, o) => {
      const c = new FakeChild(args, (role) => act(role, store));
      (c as unknown as { cwd: string }).cwd = o.cwd;
      children.push(c);
      return c as unknown as ChildLike;
    },
  });
  const seen = { smiths: [] as string[], reviewers: [] as string[] };
  const forge = new Forge({
    dir: join(home, '.agent-guild'),
    chats,
    store,
    guildUrl: 'http://127.0.0.1:4747',
    token: 'secret-token-0123456789',
    onSmith: (id) => seen.smiths.push(id),
    onReviewer: (id) => seen.reviewers.push(id),
  });
  return { forge, store, children, chats, seen };
}

describe('Forge', () => {
  it('has the Blacksmith forge in the project, read-only, then the Reviewer test the piece', async () => {
    const { forge, store, children, chats, seen } = forgeWith(async (role, store) => {
      const order = (await store.read()).orders[0]!;
      if (role === 'smith') await store.submitPiece(skillPiece(order.id));
      if (role === 'forge-reviewer')
        await store.recordReview({ id: order.id, verdict: 'ready', reason: 'Fits.' });
    });
    await store.addOrder({
      project,
      kind: 'skill',
      need: 'Write release notes like we do.',
      requestedBy: 'Percival',
    });
    await forge.kick();

    const order = (await store.read()).orders[0]!;
    expect(order.status).toBe('reviewed');
    expect(order.piece?.name).toBe('release-notes');
    const [smith, reviewer] = chats.list();
    expect(smith).toMatchObject({ name: 'Blacksmith', cwd: project, mode: 'default' });
    expect(reviewer).toMatchObject({ name: 'Reviewer' });
    expect(seen).toEqual({ smiths: [smith!.id], reviewers: [reviewer!.id] });
    expect(forge.isSmith(smith!.id) && forge.isReviewer(reviewer!.id)).toBe(true);
    // The Blacksmith can read the project but not change it.
    const tools = children[0]!.args[children[0]!.args.indexOf('--allowedTools') + 1]!;
    expect(tools).toContain('Read');
    expect(tools).not.toMatch(/\b(Edit|Write)\b/);
    expect((await stat(forge.mcpConfigFile('smith'))).mode & 0o777).toBe(0o600);
  });

  it('marks an order failed when the Blacksmith hangs nothing on the rack', async () => {
    const { forge, store, chats } = forgeWith(async () => {});
    await store.addOrder({ project, kind: 'command', need: 'A command to ship the shop.' });
    await forge.kick();
    const order = (await store.read()).orders[0]!;
    expect(order.status).toBe('failed');
    expect(order.error).toContain('without hanging a piece');
    expect(chats.list()).toHaveLength(1); // no review of nothing
  });

  it('forges nothing, and asks no review, when the Library already has it', async () => {
    const { forge, store, chats } = forgeWith(async (role, store) => {
      const order = (await store.read()).orders[0]!;
      await expect(
        store.alreadyExists({ id: order.id, name: 'release-notes', where: '', reason: '' }),
      ).rejects.toThrow('why it fits');
      await store.alreadyExists({
        id: order.id,
        name: 'release-notes',
        where: 'project',
        reason: 'It writes release notes from git history.',
      });
    });
    await store.addOrder({ project, kind: 'skill', need: 'Write release notes like we do.' });
    await forge.kick();
    const order = (await store.read()).orders[0]!;
    expect(order.status).toBe('exists');
    expect(order.existing).toEqual({
      name: 'release-notes',
      where: 'project',
      reason: 'It writes release notes from git history.',
    });
    expect(order.piece).toBeNull();
    expect(chats.list()).toHaveLength(1); // the Blacksmith only
    await expect(
      store.alreadyExists({ id: order.id, name: 'x', where: 'archive', reason: 'Again.' }),
    ).rejects.toThrow('not on the anvil');
  });

  it('fails an order left on the anvil when the guild stopped', async () => {
    const { forge, store } = forgeWith(async () => {});
    const order = await store.addOrder({ project, kind: 'skill', need: 'Something long enough.' });
    await store.update(order.id, (o) => {
      o.status = 'forging';
    });
    await forge.load();
    expect((await store.get(order.id))?.status).toBe('failed');
  });
});
