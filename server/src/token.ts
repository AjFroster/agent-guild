import { randomBytes } from 'node:crypto';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

/**
 * The token that guards the guild, kept in a file readable only by this user, so the link
 * stays the same across restarts (and when the guild starts on its own at login).
 *
 * Anyone who can read the file can use the guild, including starting Claude sessions, so
 * it is created 0600 and tightened to 0600 if it was ever loosened. Delete the file to get
 * a new token and invalidate old links.
 */
export async function loadToken(file: string): Promise<string> {
  try {
    const existing = (await readFile(file, 'utf8')).trim();
    if (/^[0-9a-f]{48}$/.test(existing)) {
      await chmod(file, 0o600);
      return existing;
    }
  } catch {
    // No token yet.
  }
  const token = randomBytes(24).toString('hex');
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  await writeFile(file, token + '\n', { mode: 0o600 });
  await chmod(file, 0o600);
  return token;
}
