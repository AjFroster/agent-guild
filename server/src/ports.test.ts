import { createServer as createHttp } from 'node:http';
import { type AddressInfo, createServer as createTcp, type Server, type Socket } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { platform, tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  type Listener,
  PortWatcher,
  listListeners,
  pagePortal,
  parseLsof,
  parseProcNetTcp,
  probe,
} from './ports.ts';

const PROC_TCP = `  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode
   0: 0100007F:1435 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 41001 1 0000000000000000 100 0 0 10 0
   1: 00000000:0BB8 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 41002 1 0000000000000000 100 0 0 10 0
   2: 0100007F:1435 0100007F:C350 01 00000000:00000000 00:00000000 00000000  1000        0 41003 1 0000000000000000 20 4 30 10 -1
`;

const LSOF = `p4242
cnode
n127.0.0.1:5173
n[::1]:5173
p777
cpostgres
n*:5432
`;

let servers: Server[] = [];
let sockets: Socket[] = [];
let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'guild-ports-'));
});
afterEach(async () => {
  sockets.forEach((s) => s.destroy());
  await Promise.all(servers.map((s) => new Promise((r) => s.close(r))));
  servers = [];
  sockets = [];
  await rm(dir, { recursive: true, force: true });
});

const listen = async (server: Server) => {
  servers.push(server);
  // Closing waits for open connections: end the ones a probe left behind.
  server.on('connection', (socket) => {
    sockets.push(socket);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return (server.address() as AddressInfo).port;
};

describe('finding listening ports', () => {
  it('reads LISTEN sockets from /proc/net/tcp, and only those', () => {
    expect(parseProcNetTcp(PROC_TCP)).toEqual([
      { port: 5173, inode: '41001' },
      { port: 3000, inode: '41002' },
    ]);
  });

  it("reads lsof's field output on macOS", () => {
    expect(parseLsof(LSOF)).toEqual([
      { pid: 4242, command: 'node', port: 5173 },
      { pid: 4242, command: 'node', port: 5173 },
      { pid: 777, command: 'postgres', port: 5432 },
    ]);
  });

  it.runIf(platform() === 'linux')(
    'finds a server this process is listening on, with its folder',
    async () => {
      const port = await listen(createTcp());
      const mine = (await listListeners()).find((l) => l.port === port);
      expect(mine).toMatchObject({ port, pid: process.pid, cwd: process.cwd() });
    },
  );

  it('tells a website (with its title) from a plain TCP service', async () => {
    const web = await listen(
      createHttp((_req, res) => {
        res.setHeader('content-type', 'text/html');
        res.end('<html><head><title>Bakery dev</title></head></html>');
      }),
    );
    expect(await probe(web)).toEqual({ http: true, status: 200, title: 'Bakery dev' });
    // A server that accepts and says nothing, like a database waiting for its protocol.
    const tcp = await listen(createTcp((socket) => socket.on('error', () => {})));
    expect(await probe(tcp, 300)).toEqual({ http: false, status: null, title: null });
  });
});

describe('PortWatcher', () => {
  const listeners: Listener[] = [
    { port: 4747, pid: 1, command: 'node', cwd: '/home/u/agent-guild' },
    { port: 5173, pid: 2, command: 'vite', cwd: '/home/u/bakery/web' },
    { port: 5432, pid: 3, command: 'postgres', cwd: '/' },
  ];
  const watcher = (list = listeners) => {
    const probed: number[] = [];
    const changes: number[][] = [];
    const w = new PortWatcher({
      dir,
      ownPort: 4747,
      knights: () => [{ id: 'k1', name: 'Tristan', cwd: '/home/u/bakery' }],
      list: async () => list,
      probe: async (port) => {
        probed.push(port);
        return port === 5173
          ? { http: true, status: 200, title: 'Bakery' }
          : { http: false, status: null, title: null };
      },
      onChange: (p) => changes.push(p.map((x) => x.port)),
      now: () => 100,
    });
    return { w, probed, changes };
  };

  it("leaves out the guild's own port, ties a service to the Knight whose folder it runs in", async () => {
    const { w } = watcher();
    const portals = await w.scan();
    expect(portals.map((p) => p.port)).toEqual([5173, 5432]);
    expect(pagePortal(portals[0]!)).toEqual({
      port: 5173,
      command: 'vite',
      folder: 'web',
      knight: { id: 'k1', name: 'Tristan' },
      http: true,
      status: 200,
      title: 'Bakery',
      name: null,
      pinned: false,
      since: 100,
    });
    expect(portals[1]).toMatchObject({ knight: null, http: false });
  });

  it('checks each port once, again only when a new process takes it, and not at all when told not to', async () => {
    let list = listeners;
    const { w, probed, changes } = watcher();
    const scan = () => {
      (w as unknown as { opts: { list: () => Promise<Listener[]> } }).opts.list = async () => list;
      return w.scan();
    };
    await scan();
    await scan();
    expect(probed).toEqual([5173, 5432]);
    expect(changes).toHaveLength(1); // nothing changed the second time
    list = listeners.map((l) => (l.port === 5173 ? { ...l, pid: 9 } : l));
    await scan();
    expect(probed).toEqual([5173, 5432, 5173]);
    await w.update({ probe: false });
    list = listeners.map((l) => (l.port === 5173 ? { ...l, pid: 10 } : l));
    await scan();
    expect(probed).toHaveLength(3);
    expect(w.list()[0]!.http).toBeUndefined();
  });

  it('remembers names, pins and hidden ports', async () => {
    const { w } = watcher();
    await w.scan();
    await w.update({ port: 5432, name: 'Bakery database', pinned: true });
    await w.update({ port: 5173, hidden: true });
    expect(w.list().map((p) => [p.port, p.name, p.pinned])).toEqual([[5432, 'Bakery database', true]]);
    expect(w.hidden()).toEqual([5173]);
    const again = watcher().w;
    await again.load();
    expect(again.settings.names).toEqual({ 5432: 'Bakery database' });
    await expect(w.update({ port: 70000, hidden: true })).rejects.toThrow('No such port');
  });
});
