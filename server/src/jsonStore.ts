import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

/**
 * One JSON file in the guild's data folder, behind the Archive, the Forge and the next
 * utilities. Writes run one after another, so two helpers cannot lose each other's work;
 * each is written to a temporary file and renamed over the old one, so a crash never
 * leaves half a file; and the file is readable by the user only.
 */
export class JsonStore<T> {
  private readonly file: string;
  /** The data from whatever was parsed (possibly nothing, or something old): never throws. */
  private readonly shape: (raw: Partial<T>) => T;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(file: string, shape: (raw: Partial<T>) => T) {
    this.file = file;
    this.shape = shape;
  }

  /** The data now; a missing or broken file reads as empty. */
  async read(): Promise<T> {
    try {
      return this.shape(JSON.parse(await readFile(this.file, 'utf8')) as Partial<T>);
    } catch {
      return this.shape({});
    }
  }

  /** Read, edit in place, write back: queued behind every earlier change. */
  change<R>(edit: (data: T) => R): Promise<R> {
    const run = this.queue.then(async () => {
      const data = await this.read();
      const result = edit(data);
      await mkdir(dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      await writeFile(tmp, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 });
      await rename(tmp, this.file);
      return result;
    });
    this.queue = run.catch(() => {});
    return run;
  }
}

/** A list from parsed JSON, or an empty one. */
export const list = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
