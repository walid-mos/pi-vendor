# web-tools

Our own tooling package: the pinned browser tooling that the agent's browser tools run from, e2e with its web engine
and chrome-devtools-mcp. Pi does not load it. `e2e.config.ts` is the agent's only e2e configuration; `start-page.mjs`
is the page a session opens on.

## Versions

`package.json` pins the tools exactly; `pnpm-lock.yaml` fixes the whole tree and is the only place their
versions are written. `pnpm-workspace.yaml` decides what dependencies may do (build scripts, agent skills), so no
install asks or approves by itself.

`node_modules/` is not committed: the dotfiles script `run_onchange_after_41-web-tools.sh.tmpl` installs it from the
frozen lockfile, with the browsers, whenever the lockfile changes. By hand, in this directory:

```sh
pnpm install --frozen-lockfile
node_modules/.bin/e2e-web install chromium firefox webkit
pi-chromium stop   # the running shared browser may be the previous build
```

To change a version: change its pin in `package.json`, run `pnpm install`, review the change as `../../AGENTS.md` says
(install scripts, network calls, files written, permissions asked), run the tests and the browser checks that concern
the tool, and commit. When `e2e` moves, update the vendored skill `../e2e` in the same commit: the skill documents that
binary.

## Run-time files

Nothing a run writes stays here. e2e is started on the pointer `~/.local/state/e2e/e2e.config.ts`, which makes that
directory its project root: results, sessions, videos and the replay cache go there. The shared Chromium and its
profile belong to `pi-chromium`, under `~/.local/state/pi-chromium`.

## Tests

```sh
node --test test/
```
