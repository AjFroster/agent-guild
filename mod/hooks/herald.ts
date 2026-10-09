/**
 * The Herald's pure parts: which guild address it accepts, what a token looks like, and
 * how a hero reads on the status line. No `$`, no I/O.
 */

export type Kind = 'permission' | 'cleared';

/** What `GET /api/hero/:session` answers. */
export type Hero = { name: string; rank: string; level: number; xp: number; status: string };

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]']);

/**
 * The guild's origin when `url` is http on loopback with no credentials in it, else
 * null: the Herald talks to nothing else.
 */
export function loopbackOrigin(url: unknown): string | null {
  if (typeof url !== 'string') return null;
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return null;
  }
  // The guild serves plain http on loopback only.
  if (parsed.protocol !== 'http:') return null;
  if (parsed.username !== '' || parsed.password !== '') return null;
  if (!LOOPBACK.has(parsed.hostname.toLowerCase())) return null;
  return parsed.origin;
}

/** A session id the guild accepts: the same rule as the server's. */
export const isSessionId = (id: unknown): id is string =>
  typeof id === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(id);

/** The token file's text as a header-safe token, or null: no spaces, newlines or oddities. */
export function tokenFrom(text: unknown): string | null {
  if (typeof text !== 'string') return null;
  const token = text.trim();
  return /^[A-Za-z0-9._~+/=-]{16,512}$/.test(token) ? token : null;
}

/** `~/x` against the home folder; any other path as given. */
export function expandHome(path: string, home: string | undefined): string | null {
  if (path === '~' || path.startsWith('~/')) return home ? home.replace(/\/+$/, '') + path.slice(1) : null;
  return path;
}

/** A hero from the guild's answer, or null when it is not one. */
export function heroFrom(text: string): Hero | null {
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof body !== 'object' || body === null) return null;
  const { name, rank, level, xp, status } = body as Record<string, unknown>;
  if (typeof name !== 'string' || typeof rank !== 'string' || typeof status !== 'string') return null;
  if (!Number.isSafeInteger(level) || !Number.isSafeInteger(xp)) return null;
  return {
    name: name.slice(0, 40),
    rank: rank.slice(0, 20),
    level: level as number,
    xp: xp as number,
    status: status.slice(0, 20),
  };
}

const capital = (word: string) => word.charAt(0).toUpperCase() + word.slice(1);

/** The status line: `⚔ Knight · Lv 3 · 320 XP`. */
export const statusLine = (hero: Hero) => `⚔ ${capital(hero.rank)} · Lv ${hero.level} · ${hero.xp} XP`;
