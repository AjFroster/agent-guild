import type { EngineInterface, HttpResponse, Register, Timer } from 'claude-code';

import {
  type Kind,
  expandHome,
  heroFrom,
  isSessionId,
  loopbackOrigin,
  statusLine,
  tokenFrom,
} from './herald.ts';

/**
 * The Herald, the Agent Guild's mod. It tells the guild when this session waits on a
 * permission prompt and when that wait ends, shows the session's hero on the status line,
 * toasts a level-up, and adds /guild.
 *
 * Its rules (docs/MOD.md): it sends the guild a session id and a kind, nothing else; it
 * never blocks or changes the session (every hook passes its event on unchanged, every
 * call to the guild is fire-and-forget or bounded by a timeout, every failure swallowed);
 * it talks to loopback only; and the token goes nowhere but the Authorization header (and,
 * on /guild, the clipboard), never into a command's text, a toast, the status line or a log.
 */

const DEFAULT_URL = 'http://127.0.0.1:4747';
const DEFAULT_TOKEN_FILE = '~/.agent-guild/token';
/** How long the Herald waits on the guild before treating it as down. */
export const TIMEOUT_MS = 2000;
/** How often the status line is refreshed between turns. */
export const REFRESH_MS = 30_000;

type $ = EngineInterface;

/** What the person configured, read as `register` runs. */
let origin: string | null = null;
let tokenFile = DEFAULT_TOKEN_FILE;

/** This load's own memory; a reload starts it over. */
let token: string | null = null;
/** The session a permission signal went out for, until its `cleared` goes to the same one. */
let waitingOn: string | null = null;
/**
 * The tool the prompt is for. The permission event carries no tool_use_id, so a call of
 * another tool (one running beside it) coming back does not end the wait; prompt.submit
 * and turn.complete end it whatever the tool.
 */
let waitingTool: string | null = null;
let lastLevel: number | null = null;
let ticker: Timer | null = null;

/**
 * `p`'s value, or undefined once it fails or `ms` pass: never a rejection.
 *
 * The timer is the only bound: `$.http.fetch` takes no abort signal, and a `clock.after`
 * another plugin refuses never fires (and does not throw). Then the wait lasts as long as
 * the fetch. Hooks never wait on it (signal() and refresh() are fire-and-forget), so only
 * /guild could, and the engine's own limit on a command's hook is the backstop there.
 */
function within<T>($: $, ms: number, p: Promise<T>): Promise<T | undefined> {
  return new Promise((resolve) => {
    let timer: Timer | undefined;
    try {
      timer = $.clock.after(ms, () => resolve(undefined));
    } catch {
      // No timer means no bound: treat the guild as down rather than wait unbounded.
      p.catch(() => {});
      resolve(undefined);
      return;
    }
    p.then(
      (value) => {
        timer?.cancel();
        resolve(value);
      },
      () => {
        timer?.cancel();
        resolve(undefined);
      },
    );
  });
}

async function readToken($: $): Promise<string | null> {
  if (token) return token;
  try {
    const home = (await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE'));
    const path = expandHome(tokenFile, home);
    token = path ? tokenFrom(await $.fs.read(path)) : null;
  } catch {
    token = null;
  }
  return token;
}

/** One request to the guild with the token, or undefined: refused address, no token, down. */
async function guild($: $, path: string, body?: string): Promise<HttpResponse | undefined> {
  if (!origin) return undefined;
  const bearer = await readToken($);
  if (!bearer) return undefined;
  const headers: Record<string, string> = { authorization: `Bearer ${bearer}` };
  if (body !== undefined) headers['content-type'] = 'application/json';
  const init = body === undefined ? { headers } : { method: 'POST', headers, body };
  return within($, TIMEOUT_MS, $.http.fetch(`${origin}${path}`, init));
}

async function sessionOf($: $): Promise<string | null> {
  try {
    const id = await $.session.id();
    return isSessionId(id) ? id : null;
  } catch {
    return null;
  }
}

async function sendSignal($: $, kind: Kind, id?: string): Promise<void> {
  const session = id ?? (await sessionOf($));
  if (!isSessionId(session)) return;
  await guild($, '/api/signal', JSON.stringify({ session, kind }));
}

/** Tells the guild `kind` for this session, without waiting for it. */
function signal($: $, kind: Kind, id?: string): void {
  sendSignal($, kind, id).catch(() => {});
}

function clearIfWaiting($: $, tool?: string): void {
  if (!waitingOn) return;
  if (tool !== undefined && waitingTool !== null && tool !== waitingTool) return;
  const id = waitingOn;
  waitingOn = null;
  waitingTool = null;
  signal($, 'cleared', id);
}

async function showHero($: $): Promise<void> {
  const session = await sessionOf($);
  const res = session ? await guild($, `/api/hero/${session}`) : undefined;
  const hero = res?.ok ? heroFrom(res.text) : null;
  if (!hero) {
    $.ui.status(undefined);
    return;
  }
  $.ui.status(statusLine(hero));
  if (lastLevel !== null && hero.level > lastLevel) {
    $.ui.toast(`${hero.name} reached level ${hero.level}!`);
  }
  lastLevel = hero.level;
}

/** The hero on the status line, a toast on a new level; the line cleared without one. */
function refresh($: $): void {
  showHero($).catch(() => {});
}

async function guildCommand($: $): Promise<string> {
  if (!origin) {
    return 'The Herald only talks to a guild on this machine (127.0.0.1, localhost or ::1). Set guild_url in /config.';
  }
  const health = await within($, TIMEOUT_MS, $.http.fetch(`${origin}/api/health`));
  if (!health?.ok) return `The guild is not reachable at ${origin}. Start it with npm start in agent-guild.`;
  const bearer = await readToken($);
  if (!bearer) {
    return `The guild is up at ${origin}, but the Herald found no token. Check token_file in /config.`;
  }
  const session = await sessionOf($);
  const res = session ? await guild($, `/api/hero/${session}`) : undefined;
  const hero = res?.ok ? heroFrom(res.text) : null;
  const line =
    res?.status === 401
      ? 'The guild refused the token: is token_file the running guild’s?'
      : hero
        ? `${hero.name}: ${statusLine(hero)}.`
        : 'This session has no hero in the guild yet.';
  const copied = await within($, TIMEOUT_MS, $.ui.copy({ text: `${origin}/?token=${bearer}` }));
  const link = copied?.isCopied
    ? 'The village link is on your clipboard.'
    : 'The village link could not be copied here.';
  return `The guild is up at ${origin}. ${line} ${link}`;
}

export const register: Register = (on, options) => {
  origin = loopbackOrigin(options.guild_url ?? DEFAULT_URL);
  tokenFile =
    typeof options.token_file === 'string' && options.token_file.trim() !== ''
      ? options.token_file.trim()
      : DEFAULT_TOKEN_FILE;
  token = null;
  waitingOn = null;
  waitingTool = null;
  lastLevel = null;
  ticker = null;

  on('session.start', async ($, e, next) => {
    try {
      await $.command.register({
        name: 'guild',
        description: 'Is the Agent Guild up? Shows your hero and copies the village link.',
      });
    } catch {
      // No /guild this session; everything else still works.
    }
    ticker?.cancel();
    ticker = $.clock.every(REFRESH_MS, () => refresh($));
    refresh($);
    return next(e);
  }).catch(($, e, next) => next(e));

  // The one moment the transcript cannot show: a permission prompt is up.
  on('classic.PermissionRequest', ($, e, next) => {
    // A cleared goes only where a permission went, and to that same session.
    if (isSessionId(e.session_id)) {
      waitingOn = e.session_id;
      waitingTool = typeof e.tool_name === 'string' && e.tool_name !== '' ? e.tool_name : null;
      signal($, 'permission', e.session_id);
    }
    return next(e);
  }).catch(($, e, next) => next(e));

  // The prompt was answered when the call it held up comes back (allowed or denied).
  // Also when the call fails beneath: the prompt was still answered. The failure itself
  // goes on unchanged.
  on('tool.call', async ($, e, next) => {
    try {
      return await next(e);
    } finally {
      clearIfWaiting($, e.tool);
    }
  }).catch(($, e, next) => next(e));

  on('prompt.submit', ($, e, next) => {
    clearIfWaiting($);
    return next(e);
  }).catch(($, e, next) => next(e));

  on('turn.complete', ($, e, next) => {
    clearIfWaiting($);
    refresh($);
    return next(e);
  }).catch(($, e, next) => next(e));

  on('command.run', { command: 'guild' }, async ($) => ({ text: await guildCommand($) })).catch(() => ({
    text: 'The Herald could not reach the guild.',
  }));
};
