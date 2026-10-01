import type { ChatItem } from '@agent-guild/core';

/**
 * Calls to the guild server's control routes. The token from the page URL goes in the
 * Authorization header; the server refuses anything without it.
 */

export interface ChatInfo {
  id: string;
  name: string;
  cwd: string;
  mode: ChatMode;
  running: boolean;
  busy: boolean;
  loginRequired: boolean;
  startedAt: number;
}

export const CHAT_MODES = ['acceptEdits', 'plan', 'auto', 'default', 'bypassPermissions'] as const;
export type ChatMode = (typeof CHAT_MODES)[number];

export const MODE_LABEL: Record<ChatMode, string> = {
  acceptEdits: 'Edit files freely, ask before anything else',
  plan: 'Plan only: read and propose, change nothing',
  auto: 'Auto: a classifier approves safe actions',
  default: 'Ask for everything (actions needing approval are refused)',
  bypassPermissions: 'Skip all permission checks (dangerous)',
};

export interface CrierConfig {
  enabled: boolean;
  time: string;
  threshold: number;
  maxItems: number;
  lastRunDate: string | null;
  lastChatId: string | null;
}

export interface CrierStatus {
  config: CrierConfig;
  nextRunAt: number | null;
  reports: { date: string; bytes: number }[];
}

export type Verdict = 'gap' | 'better' | 'duplicate' | 'risky';
export type EntryStatus = 'candidate' | 'reviewed' | 'installed' | 'dismissed';

export interface ArchiveEntry {
  id: string;
  name: string;
  repo: string;
  path: string;
  commit: string;
  stars: number;
  description: string;
  foundAt: number;
  review: {
    verdict: Verdict;
    reason: string;
    overlaps: string[];
    risks: string[];
    reviewedAt: number;
  } | null;
  status: EntryStatus;
  installedAt: number | null;
}

export interface InstalledSkill {
  name: string;
  description: string;
  source: 'personal' | 'synced' | 'plugin';
  path: string;
}

export interface LibrarySchedule {
  enabled: boolean;
  time: string;
  maxCandidates: number;
  minStars: number;
  lastRunDate: string | null;
}

export interface SkillsStatus {
  installed: InstalledSkill[];
  entries: ArchiveEntry[];
  notes: { at: number; by: string; text: string }[];
  waiting: number;
  library?: { config: LibrarySchedule; nextRunAt: number | null; running: boolean };
}

export interface ChatSnapshot {
  info: ChatInfo;
  items: ChatItem[];
}

export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export type PieceKind = 'skill' | 'command';
export type OrderStatus =
  'requested' | 'forging' | 'forged' | 'reviewed' | 'installed' | 'dismissed' | 'failed';

export interface ForgeOrder {
  id: string;
  project: string;
  requestedBy: string;
  knightId: string | null;
  kind: PieceKind;
  need: string;
  status: OrderStatus;
  piece: {
    name: string;
    description: string;
    files: { path: string; content: string }[];
    forgedAt: number;
  } | null;
  review: {
    verdict: 'ready' | 'needs-work' | 'risky';
    reason: string;
    risks: string[];
    reviewedAt: number;
  } | null;
  createdAt: number;
  installedAt: number | null;
  error: string | null;
}

export interface ForgeStatus {
  orders: ForgeOrder[];
  current: string | null;
  waiting: number;
}

export function api(token: string) {
  const call = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
    const res = await fetch(path, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) throw new ApiError(res.status, data.error ?? `Request failed (${res.status}).`);
    return data as T;
  };
  return {
    control: () => call<{ chats: ChatInfo[]; projects: string[]; crier: CrierStatus }>('GET', '/api/control'),
    startChat: (body: { cwd: string; name?: string; mode: ChatMode; message: string }) =>
      call<ChatInfo>('POST', '/api/chats', body),
    send: (id: string, text: string) =>
      call<{ ok: true }>('POST', `/api/chats/${encodeURIComponent(id)}/messages`, { text }),
    stop: (id: string) => call<{ ok: true }>('POST', `/api/chats/${encodeURIComponent(id)}/stop`),
    /** Talk to the King; the first message crowns one. */
    speakToKing: (text: string) => call<{ id: string }>('POST', '/api/king/messages', { text }),
    crier: () => call<CrierStatus>('GET', '/api/crier'),
    skills: () => call<SkillsStatus>('GET', '/api/skills'),
    dismissSkill: (id: string) => call<ArchiveEntry>('POST', `/api/skills/${encodeURIComponent(id)}/dismiss`),
    rereviewSkill: (id: string) =>
      call<ArchiveEntry>('POST', `/api/skills/${encodeURIComponent(id)}/rereview`),
    installSkill: (id: string) => call<ArchiveEntry>('POST', `/api/skills/${encodeURIComponent(id)}/install`),
    updateLibrary: (patch: Partial<LibrarySchedule>) => call<SkillsStatus>('PUT', '/api/library', patch),
    runLibrary: () => call<{ ok: true }>('POST', '/api/library/run'),
    forge: () => call<ForgeStatus>('GET', '/api/forge'),
    commission: (body: { project: string; kind: PieceKind; need: string }) =>
      call<{ id: string }>('POST', '/api/forge/orders', body),
    installPiece: (id: string) =>
      call<unknown>('POST', `/api/forge/orders/${encodeURIComponent(id)}/install`),
    dismissPiece: (id: string) =>
      call<unknown>('POST', `/api/forge/orders/${encodeURIComponent(id)}/dismiss`),
    reforge: (id: string) => call<unknown>('POST', `/api/forge/orders/${encodeURIComponent(id)}/reforge`),
    updateCrier: (patch: Partial<CrierConfig>) => call<CrierStatus>('PUT', '/api/crier', patch),
    runCrier: () => call<ChatInfo>('POST', '/api/crier/run'),
    report: (date: string) =>
      call<{ date: string; text: string }>('GET', `/api/crier/reports/${encodeURIComponent(date)}`),
    chatStreamUrl: (id: string) =>
      `/api/chats/${encodeURIComponent(id)}/stream?token=${encodeURIComponent(token)}`,
  };
}

export type Api = ReturnType<typeof api>;
