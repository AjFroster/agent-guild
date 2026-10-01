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
    crier: () => call<CrierStatus>('GET', '/api/crier'),
    updateCrier: (patch: Partial<CrierConfig>) => call<CrierStatus>('PUT', '/api/crier', patch),
    runCrier: () => call<ChatInfo>('POST', '/api/crier/run'),
    report: (date: string) =>
      call<{ date: string; text: string }>('GET', `/api/crier/reports/${encodeURIComponent(date)}`),
    chatStreamUrl: (id: string) =>
      `/api/chats/${encodeURIComponent(id)}/stream?token=${encodeURIComponent(token)}`,
  };
}

export type Api = ReturnType<typeof api>;
