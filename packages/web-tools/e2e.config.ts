// e2e.config.ts: the only e2e configuration of the agent tooling on this machine.
// It lives in our tooling package (pi-vendor/packages/web-tools): e2e resolves a config's imports from the config's
// own directory, so the config sits beside the node_modules that the dotfiles install from this package's lockfile.
// e2e is started on the pointer ~/.local/state/e2e/e2e.config.ts, which re-exports this file: that directory is the
// project root, so results, videos and the replay cache go there with e2e's defaults, outside every repository.
// - chromium: the shared Chromium owned by ~/.local/bin/pi-chromium, reached over CDP. e2e never launches Chromium;
//   opening a chromium session is the only thing that starts the shared browser.
// - firefox, webkit: launched by e2e itself, for cross-browser passes.
// A session opens on a local start page (e2e gives a config session no URL input); its first action is `navigate`.
// Logins: the agent's Bitwarden collection, declared from the index `agent-bw sync` writes (logins.ts); each secret is
// read through ~/.local/bin/agent-bw when e2e fills it.
import { execFile } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { E2EConfig } from 'e2e';
import { web } from '@e2e-dev/web';
import { indexAt, loginsFromIndex, type SecretKind } from './logins.ts';

const run = promisify(execFile);
const PI_CHROMIUM = join(homedir(), '.local/bin/pi-chromium');
const AGENT_BW = join(homedir(), '.local/bin/agent-bw');
const LOGIN_INDEX = join(homedir(), '.local/state/e2e/logins.json');

// Started by pi-chromium when it is not running, reused when it is. A failure rejects with pi-chromium's own
// message, and the session does not open: there is no other browser to use.
async function sharedChromium(signal: AbortSignal): Promise<string> {
  const { stdout } = await run(PI_CHROMIUM, ['ensure'], { signal });
  return stdout.trim();
}

// One secret from Bitwarden; a failure rejects with agent-bw's own message, and e2e fails that fill.
async function readSecret(kind: SecretKind, item: string): Promise<string> {
  const { stdout } = await run(AGENT_BW, [kind, item]);
  return stdout.replace(/\n$/, '');
}

const logins = loginsFromIndex(indexAt(LOGIN_INDEX, (line) => console.error(line)), readSecret);

// Port 0: e2e picks a free port and starts one start page per session, so two Pi sessions never collide.
const app = {
  url: 'http://127.0.0.1:0',
  command: { executable: process.execPath, args: [join(import.meta.dirname, 'start-page.mjs'), '{port}'] },
};

export default {
  targets: [
    { name: 'chromium', engine: web({ connect: { cdpEndpoint: sharedChromium } }), app },
    { name: 'firefox', engine: web({ browser: 'firefox' }), app },
    { name: 'webkit', engine: web({ browser: 'webkit' }), app },
  ],
  credentials: logins.credentials,
  secrets: logins.secrets,
} satisfies E2EConfig;
