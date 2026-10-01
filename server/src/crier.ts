import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { ChatInfo, ChatManager } from './chats.ts';

/**
 * The Town Crier: a Claude Code session the guild starts once a day to write a report on
 * the latest in tech and AI, keeping only stories that clear an importance cutoff.
 *
 * It runs inside the guild server, so it fires only while the server is up; if the
 * scheduled time passed while it was down, it runs once when the guild next starts that
 * day. Each run is an ordinary chat, so it shows up as a hero and can be opened and
 * continued like any other session.
 */

export interface CrierConfig {
  enabled: boolean;
  /** Local time of day, "HH:MM". */
  time: string;
  /** Include stories scored at or above this (1-10). */
  threshold: number;
  maxItems: number;
  /** Local date ("YYYY-MM-DD") of the last run, so it runs once a day. */
  lastRunDate: string | null;
  lastChatId: string | null;
}

/** Off until the user turns it on: each run spends their Claude usage. */
export const DEFAULT_CRIER: CrierConfig = {
  enabled: false,
  time: '18:00',
  threshold: 7,
  maxItems: 10,
  lastRunDate: null,
  lastChatId: null,
};

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function localDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Due when enabled, not yet run today, and the scheduled time has passed. */
/** The part of a daily schedule that says when it runs: the Town Crier's and the librarians'. */
export type Schedule = Pick<CrierConfig, 'enabled' | 'time' | 'lastRunDate'>;

export function isDue(config: Schedule, now: Date): boolean {
  const m = TIME.exec(config.time);
  if (!config.enabled || !m) return false;
  if (config.lastRunDate === localDate(now)) return false;
  return now.getHours() * 60 + now.getMinutes() >= Number(m[1]) * 60 + Number(m[2]);
}

/** The next time it will run, for showing in the UI. */
export function nextRun(config: Schedule, now: Date): Date | null {
  const m = TIME.exec(config.time);
  if (!config.enabled || !m) return null;
  const at = new Date(now);
  at.setHours(Number(m[1]), Number(m[2]), 0, 0);
  if (config.lastRunDate === localDate(now))
    at.setDate(at.getDate() + 1); // done today
  else if (at < now) return now; // missed today's time: runs on the next tick
  return at;
}

export function validatePatch(patch: Partial<CrierConfig>): Partial<CrierConfig> {
  const out: Partial<CrierConfig> = {};
  if (patch.enabled !== undefined) out.enabled = Boolean(patch.enabled);
  if (patch.time !== undefined) {
    if (typeof patch.time !== 'string' || !TIME.test(patch.time))
      throw new Error('Time must be HH:MM, 24-hour.');
    out.time = patch.time;
  }
  if (patch.threshold !== undefined) {
    const n = Number(patch.threshold);
    if (!Number.isInteger(n) || n < 1 || n > 10)
      throw new Error('The cutoff must be a whole number from 1 to 10.');
    out.threshold = n;
  }
  if (patch.maxItems !== undefined) {
    const n = Number(patch.maxItems);
    if (!Number.isInteger(n) || n < 1 || n > 25) throw new Error('Max stories must be from 1 to 25.');
    out.maxItems = n;
  }
  return out;
}

export function crierPrompt(config: CrierConfig, date: string): string {
  return [
    `You are the Town Crier of an Agent Guild. Today is ${date}. Write today's report on the latest in technology and AI.`,
    '',
    '1. Search the web (several queries: AI model releases, AI research, AI policy and regulation, big tech, developer tools, security, chips and hardware, startups and funding) for news from the last 24 hours. Widen to 48 hours only if the day was quiet.',
    `2. Score each story from 1 to 10 for significance to a software developer who follows tech and AI (10 = changes the industry, 5 = worth knowing, 1 = noise). Include only stories scoring ${config.threshold} or higher, at most ${config.maxItems}. If nothing clears the bar, say so plainly instead of padding.`,
    '3. Check each story you include against a primary or reputable source.',
    `4. Write the report to the file ${date}.md in the current folder: a title "Town Crier: ${date}", a two or three sentence overview, then one section per story with the headline, its score, a two to four sentence summary, why it matters, and source links. End with a short "Below the bar" list of up to five notable stories that scored under ${config.threshold}, one line each.`,
    '5. Reply with the overview and the file name.',
  ].join('\n');
}

export interface CrierOptions {
  dir: string;
  chats: ChatManager;
  now?: () => Date;
  onChange?: () => void;
}

export class TownCrier {
  config: CrierConfig = { ...DEFAULT_CRIER };
  private readonly opts: CrierOptions;
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(opts: CrierOptions) {
    this.opts = opts;
  }

  get reportsDir(): string {
    return join(this.opts.dir, 'town-crier');
  }

  private get configFile(): string {
    return join(this.opts.dir, 'town-crier.json');
  }

  async load(): Promise<void> {
    try {
      const raw = JSON.parse(await readFile(this.configFile, 'utf8')) as Partial<CrierConfig>;
      this.config = { ...DEFAULT_CRIER, ...raw };
    } catch {
      this.config = { ...DEFAULT_CRIER };
    }
  }

  private async save(): Promise<void> {
    await mkdir(this.opts.dir, { recursive: true });
    await writeFile(this.configFile, JSON.stringify(this.config, null, 2) + '\n', { mode: 0o600 });
    this.opts.onChange?.();
  }

  async update(patch: Partial<CrierConfig>): Promise<CrierConfig> {
    this.config = { ...this.config, ...validatePatch(patch) };
    await this.save();
    return this.config;
  }

  start(everyMs = 60_000): void {
    void this.tick();
    this.timer = setInterval(() => void this.tick(), everyMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async tick(): Promise<void> {
    if (isDue(this.config, this.now())) await this.run();
  }

  /** Start today's report now, whatever the schedule says. */
  async run(): Promise<ChatInfo> {
    if (this.running) throw new Error('The Town Crier is already starting.');
    this.running = true;
    try {
      const date = localDate(this.now());
      await mkdir(this.reportsDir, { recursive: true });
      // Recorded before starting, so a failing run is not retried every minute.
      this.config = { ...this.config, lastRunDate: date };
      const info = await this.opts.chats.start({
        cwd: this.reportsDir,
        name: 'Town Crier',
        mode: 'acceptEdits',
        message: crierPrompt(this.config, date),
        allowedTools: ['WebSearch', 'WebFetch'],
      });
      this.config = { ...this.config, lastChatId: info.id };
      await this.save();
      return info;
    } finally {
      this.running = false;
    }
  }

  async reports(): Promise<{ date: string; bytes: number }[]> {
    let names: string[];
    try {
      names = await readdir(this.reportsDir);
    } catch {
      return [];
    }
    const out: { date: string; bytes: number }[] = [];
    for (const name of names) {
      const date = name.replace(/\.md$/, '');
      if (!name.endsWith('.md') || !DATE.test(date)) continue;
      out.push({ date, bytes: (await stat(join(this.reportsDir, name))).size });
    }
    return out.sort((a, b) => b.date.localeCompare(a.date));
  }

  async report(date: string): Promise<string | null> {
    if (!DATE.test(date)) return null;
    try {
      return await readFile(join(this.reportsDir, `${date}.md`), 'utf8');
    } catch {
      return null;
    }
  }

  private now(): Date {
    return this.opts.now?.() ?? new Date();
  }
}
