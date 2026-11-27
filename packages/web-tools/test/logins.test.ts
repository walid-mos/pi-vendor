import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { indexAt, loginsFromIndex, type SecretKind } from '../logins.ts';

// Invented logins: this repository is public.
const shop = { name: 'example-shop', item: 'item-1', username: 'agent@example.test', totp: false };
const club = { name: 'example-club', item: 'item-2', username: 'club@example.test', totp: true };

function reader() {
  const asked: [SecretKind, string][] = [];
  const read = async (kind: SecretKind, item: string) => {
    asked.push([kind, item]);
    return `${kind} of ${item}`;
  };
  return { asked, read };
}

test('a login without TOTP gives one credential and its previous password, and no .totp secret', () => {
  const { credentials, secrets } = loginsFromIndex({ logins: [shop] }, reader().read);
  assert.deepEqual(Object.keys(credentials), ['example-shop']);
  assert.equal(credentials['example-shop'].username, 'agent@example.test');
  assert.deepEqual(Object.keys(secrets), ['example-shop.previous-password']);
});

test('a login with TOTP also gives its .totp secret', () => {
  const { secrets } = loginsFromIndex({ logins: [club] }, reader().read);
  assert.deepEqual(Object.keys(secrets).sort(), ['example-club.previous-password', 'example-club.totp']);
});

test('each secret asks the reader for its kind and item, when filled, and returns its value', async () => {
  const { asked, read } = reader();
  const { credentials, secrets } = loginsFromIndex({ logins: [club] }, read);
  assert.deepEqual(asked, [], 'nothing is read at config load');
  assert.equal(await credentials['example-club'].password(), 'password of item-2');
  assert.equal(await secrets['example-club.totp'](), 'totp of item-2');
  assert.equal(await secrets['example-club.previous-password'](), 'previous-password of item-2');
  assert.deepEqual(asked, [
    ['password', 'item-2'],
    ['totp', 'item-2'],
    ['previous-password', 'item-2'],
  ]);
});

const malformed: [string, unknown, RegExp][] = [
  ['an entry with an unknown key', { logins: [{ ...shop, managed: true }] }, /example-shop.*managed/],
  ['an entry without username', { logins: [{ name: 'example-shop', item: 'item-1', totp: false }] }, /example-shop.*username/],
  ['an entry whose totp is not a boolean', { logins: [{ ...shop, totp: 'no' }] }, /example-shop.*totp/],
  ['two entries with one name', { logins: [shop, { ...shop, item: 'item-9' }] }, /example-shop.*item-1.*item-9/],
  ['an index with another top-level key', { logins: [], extra: 1 }, /extra/],
  ['an index without logins', {}, /logins/],
];

for (const [what, index, message] of malformed) {
  test(`${what} throws, naming it`, () => {
    assert.throws(() => loginsFromIndex(index, reader().read), message);
  });
}

function tempDir(t: { after: (f: () => void) => void }): string {
  const dir = mkdtempSync(join(tmpdir(), 'logins-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('indexAt reads the index file', (t) => {
  const path = join(tempDir(t), 'logins.json');
  writeFileSync(path, JSON.stringify({ logins: [shop] }));
  const warnings: string[] = [];
  assert.deepEqual(indexAt(path, (line) => warnings.push(line)), { logins: [shop] });
  assert.deepEqual(warnings, []);
});

test('a missing index declares no login and says so once, naming agent-bw sync', (t) => {
  const warnings: string[] = [];
  assert.deepEqual(indexAt(join(tempDir(t), 'none.json'), (line) => warnings.push(line)), { logins: [] });
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /agent-bw sync/);
});

test('an index that is not JSON fails the config load, naming the file', (t) => {
  const path = join(tempDir(t), 'logins.json');
  writeFileSync(path, '{"logins": [');
  assert.throws(() => indexAt(path, () => {}), new RegExp(path.replaceAll('/', '\\/')));
});
