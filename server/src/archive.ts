import { createHash } from 'node:crypto';

import { ChatError } from './chats.ts';
import { JsonStore, list as listOf } from './jsonStore.ts';

/**
 * The Archive in the Library: every skill the librarians have found and reviewed, and
 * what became of it. The Scout adds candidates, the Reviewer records a verdict, and the
 * user decides: install, dismiss, or ask for another review. Nothing is installed without
 * the user (see install.ts).
 *
 * Kept in one JSON file in the guild's data folder, read fresh for every request (it is
 * small) and written atomically, one write at a time.
 */

export type Verdict = 'gap' | 'better' | 'duplicate' | 'risky';
export type EntryStatus = 'candidate' | 'reviewed' | 'installed' | 'dismissed';

export interface Review {
  verdict: Verdict;
  /** Why, in a sentence or two. */
  reason: string;
  /** Installed skills it overlaps with or would replace, by name. */
  overlaps: string[];
  /** Anything risky in its instructions or scripts. */
  risks: string[];
  reviewedAt: number;
}

export interface ArchiveEntry {
  /** Stable id from the repository and folder. */
  id: string;
  name: string;
  /** "owner/repo" on GitHub. */
  repo: string;
  /** The skill's folder inside the repository ("" for the root). */
  path: string;
  /** The exact commit that was (or will be) reviewed, and the only one ever installed. */
  commit: string;
  stars: number;
  description: string;
  foundAt: number;
  review: Review | null;
  status: EntryStatus;
  installedAt: number | null;
}

export interface Note {
  at: number;
  by: string;
  text: string;
}

interface ArchiveFile {
  entries: ArchiveEntry[];
  notes: Note[];
}

export interface Candidate {
  name: unknown;
  repo: unknown;
  path?: unknown;
  commit: unknown;
  stars?: unknown;
  description?: unknown;
}

export interface ReviewInput {
  id: unknown;
  verdict: unknown;
  reason: unknown;
  overlaps?: unknown;
  risks?: unknown;
}

const REPO = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/;
const PATH = /^[A-Za-z0-9_.\-/]{0,300}$/;
const COMMIT = /^[0-9a-f]{40}$/;
const NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;
const VERDICTS: readonly Verdict[] = ['gap', 'better', 'duplicate', 'risky'];
const MAX_NOTES = 60;

const clip = (v: unknown, n: number) =>
  String(v ?? '')
    .trim()
    .slice(0, n);
const list = (v: unknown, n: number) =>
  (Array.isArray(v) ? v : [])
    .map((x) => clip(x, 200))
    .filter(Boolean)
    .slice(0, n);

/** The id for a skill: its repository and folder, so a new commit updates the same entry. */
export function entryId(repo: string, path: string): string {
  return createHash('sha256').update(`${repo.toLowerCase()}:${path}`).digest('hex').slice(0, 12);
}

/** A candidate checked field by field: these values later choose what gets downloaded. */
export function checkCandidate(
  c: Candidate,
): Omit<ArchiveEntry, 'id' | 'foundAt' | 'review' | 'status' | 'installedAt'> {
  const repo = clip(c.repo, 201);
  const path = clip(c.path, 300).replace(/^\/+|\/+$/g, '');
  const commit = clip(c.commit, 40).toLowerCase();
  const name = clip(c.name, 64).toLowerCase();
  if (!REPO.test(repo)) throw new ChatError(400, 'repo must be "owner/name" on GitHub.');
  if (!PATH.test(path) || path.split('/').some((p) => p === '..' || p === '.')) {
    throw new ChatError(400, 'path must be a plain folder path inside the repository.');
  }
  if (!COMMIT.test(commit)) throw new ChatError(400, 'commit must be a full 40-character commit hash.');
  if (!NAME.test(name)) throw new ChatError(400, 'name must be lowercase letters, digits and hyphens.');
  const stars = Number(c.stars ?? 0);
  return {
    name,
    repo,
    path,
    commit,
    stars: Number.isFinite(stars) && stars > 0 ? Math.floor(stars) : 0,
    description: clip(c.description, 600),
  };
}

export class Archive {
  /** Writes run one after another, so two librarians cannot lose each other's work. */
  private readonly store: JsonStore<ArchiveFile>;
  private readonly now: () => number;

  constructor(file: string, now: () => number = () => Date.now() / 1000) {
    this.store = new JsonStore(file, (raw) => ({
      entries: listOf<ArchiveEntry>(raw.entries),
      notes: listOf<ArchiveFile['notes'][number]>(raw.notes),
    }));
    this.now = now;
  }

  read(): Promise<ArchiveFile> {
    return this.store.read();
  }

  private change<T>(edit: (data: ArchiveFile) => T): Promise<T> {
    return this.store.change(edit);
  }

  /**
   * Add a skill the Scout found. One already in the Archive at the same commit is left as
   * it is; at a new commit it goes back to be reviewed again, since the code changed.
   */
  async addCandidate(c: Candidate): Promise<{ entry: ArchiveEntry; added: boolean }> {
    const fields = checkCandidate(c);
    const id = entryId(fields.repo, fields.path);
    return this.change((data) => {
      const existing = data.entries.find((e) => e.id === id);
      if (existing && existing.commit === fields.commit) return { entry: existing, added: false };
      const entry: ArchiveEntry = {
        ...fields,
        id,
        foundAt: this.now(),
        review: null,
        status: 'candidate',
        installedAt: existing?.installedAt ?? null,
      };
      data.entries = [entry, ...data.entries.filter((e) => e.id !== id)];
      return { entry, added: true };
    });
  }

  async recordReview(r: ReviewInput): Promise<ArchiveEntry> {
    const verdict = clip(r.verdict, 20) as Verdict;
    if (!VERDICTS.includes(verdict))
      throw new ChatError(400, `verdict must be one of ${VERDICTS.join(', ')}.`);
    const reason = clip(r.reason, 1000);
    if (!reason) throw new ChatError(400, 'Give a reason for the verdict.');
    return this.change((data) => {
      const entry = data.entries.find((e) => e.id === clip(r.id, 40));
      if (!entry) throw new ChatError(404, 'No such entry in the Archive.');
      entry.review = {
        verdict,
        reason,
        overlaps: list(r.overlaps, 10),
        risks: list(r.risks, 10),
        reviewedAt: this.now(),
      };
      if (entry.status === 'candidate') entry.status = 'reviewed';
      return entry;
    });
  }

  setStatus(id: string, status: EntryStatus, extra: Partial<ArchiveEntry> = {}): Promise<ArchiveEntry> {
    return this.change((data) => {
      const entry = data.entries.find((e) => e.id === id);
      if (!entry) throw new ChatError(404, 'No such entry in the Archive.');
      Object.assign(entry, extra, { status });
      return entry;
    });
  }

  async get(id: string): Promise<ArchiveEntry | null> {
    return (await this.read()).entries.find((e) => e.id === id) ?? null;
  }

  async addNote(by: string, text: string): Promise<Note> {
    const note = { at: this.now(), by: clip(by, 40), text: clip(text, 2000) };
    if (!note.text) throw new ChatError(400, 'The note is empty.');
    return this.change((data) => {
      data.notes = [note, ...data.notes].slice(0, MAX_NOTES);
      return note;
    });
  }
}

/** Reviewed skills waiting on the user's decision: the badge on the Skills tab. */
export function waitingForUser(entries: ArchiveEntry[]): ArchiveEntry[] {
  return entries.filter((e) => e.status === 'reviewed');
}
