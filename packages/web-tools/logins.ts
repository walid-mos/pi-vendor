// logins.ts: the agent's logins as e2e credentials and secrets, from the index that `agent-bw sync` writes.
// The index holds no secret: each password, one-time code or previous password is read from Bitwarden by the reader
// when e2e fills it, never at config load. Every login of the agent's collection can be rotated, so each one also
// gives `<name>.previous-password`, which a rotation types as the current password the site still expects.
import { readFileSync } from 'node:fs';

export type SecretKind = 'password' | 'totp' | 'previous-password';
export type ReadSecret = (kind: SecretKind, item: string) => Promise<string>;
type Login = { name: string; item: string; username: string; totp: boolean };
type Provider = () => Promise<string>;

const ENTRY_KEYS = ['name', 'item', 'username', 'totp'];

function checkedLogins(index: unknown): Login[] {
  if (typeof index !== 'object' || index === null || Array.isArray(index)) throw new Error('the login index is not an object');
  const extra = Object.keys(index).filter((key) => key !== 'logins');
  if (extra.length > 0) throw new Error(`the login index has unknown keys: ${extra.join(', ')}`);
  const logins = (index as { logins?: unknown }).logins;
  if (!Array.isArray(logins)) throw new Error('the login index has no logins list');
  const items = new Map<string, string>();
  return logins.map((entry: unknown, position) => {
    const named = typeof entry === 'object' && entry !== null && typeof (entry as Login).name === 'string' ? (entry as Login).name : `entry ${position}`;
    const fail = (why: string) => new Error(`login ${named} in the index: ${why}`);
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) throw fail('not an object');
    const unknown = Object.keys(entry).filter((key) => !ENTRY_KEYS.includes(key));
    if (unknown.length > 0) throw fail(`unknown keys ${unknown.join(', ')}`);
    const login = entry as Login;
    for (const key of ['name', 'item', 'username'] as const) {
      if (typeof login[key] !== 'string' || login[key] === '') throw fail(`${key} is missing or not a string`);
    }
    if (typeof login.totp !== 'boolean') throw fail('totp is not a boolean');
    const before = items.get(login.name);
    if (before !== undefined) throw fail(`two items give this name: ${before} and ${login.item}`);
    items.set(login.name, login.item);
    return login;
  });
}

/** e2e's credentials and secrets for the logins of an index; a malformed index throws, which fails the config load. */
export function loginsFromIndex(index: unknown, readSecret: ReadSecret) {
  const credentials: Record<string, { username: string; password: Provider }> = {};
  const secrets: Record<string, Provider> = {};
  for (const login of checkedLogins(index)) {
    credentials[login.name] = { username: login.username, password: () => readSecret('password', login.item) };
    secrets[`${login.name}.previous-password`] = () => readSecret('previous-password', login.item);
    if (login.totp) secrets[`${login.name}.totp`] = () => readSecret('totp', login.item);
  }
  return { credentials, secrets };
}

/**
 * The index at `path`. A missing index declares no login, and `warn` says so; an index that cannot be read or parsed
 * throws, naming the file.
 */
export function indexAt(path: string, warn: (line: string) => void): unknown {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error(`cannot read the login index ${path}`, { cause: error });
    warn(`e2e config: no login index at ${path}, so no login is declared; run agent-bw sync to write it`);
    return { logins: [] };
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`the login index ${path} is not JSON`, { cause: error });
  }
}
