/**
 * The link the server prints carries the token in `?token=`. The page keeps it in this
 * origin's localStorage and takes it out of the address bar, so it does not sit in the
 * browser's history or get copied along with a link to a selection. Afterwards the plain
 * address (`http://127.0.0.1:<port>/`) opens the guild too.
 */

const KEY = 'agent-guild:token';

export interface TokenStore {
  get(): string | null;
  set(token: string): void;
  clear(): void;
}

/** localStorage, or nothing when the browser blocks it (the URL token still works). */
export const browserStore: TokenStore = {
  get: () => {
    try {
      return localStorage.getItem(KEY);
    } catch {
      return null;
    }
  },
  set: (token) => {
    try {
      localStorage.setItem(KEY, token);
    } catch {
      // Blocked storage: this tab still has the token, a new one needs the link again.
    }
  },
  clear: () => {
    try {
      localStorage.removeItem(KEY);
    } catch {
      // Nothing stored, then.
    }
  },
};

/**
 * The token to use, and the address to show instead of the current one (null when it
 * does not change). A token in the URL wins over a stored one: it is the newest link.
 */
export function takeToken(
  href: string,
  store: TokenStore,
): { token: string | null; cleanHref: string | null } {
  const url = new URL(href);
  const given = url.searchParams.get('token');
  if (!given) return { token: store.get(), cleanHref: null };
  store.set(given);
  url.searchParams.delete('token');
  return { token: given, cleanHref: url.pathname + url.search + url.hash };
}
