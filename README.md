# pi-vendor

[Pi](https://github.com/earendil-works/pi) packages, reviewed and pinned: vendored third-party packages, and two packages of our own (`web`, `web-tools`) whose code is edited here.

Pi loads each package from this checkout as a local package, so nothing is fetched from npm at runtime and nothing changes without a reviewed commit here.

## Layout

```
vendor.json          # source, pinned version or commit, integrity and review notes for each package
packages/<dir>/      # upstream contents (an npm tarball or a git commit, only the entry's paths when it lists some) with patches/<dir> applied, never edited by hand
patches/<dir>/       # local changes, applied on top of packages/<dir> after each update
packages/web/        # our own Pi package: code edited here; node_modules/ vendored from its lockfile and committed
packages/web-tools/  # our own tooling, not loaded by Pi (e2e, MCP servers): pnpm-lock.yaml committed, node_modules/ installed by the dotfiles
```

## Packages

| Dir | Upstream | Version |
|---|---|---|
| `web` | ours (`source: own`): the tools `web_search` and `fetch_content`, with `@mozilla/readability`, `linkedom`, `turndown` and `unpdf` vendored | `package.json` and `pnpm-lock.yaml` |
| `web-tools` | ours (`source: own`), not loaded by Pi: e2e, `@e2e-dev/web` and chrome-devtools-mcp, pinned; `node_modules` installed by the dotfiles | `package.json` and `pnpm-lock.yaml` |
| `e2e` | [`e2e`](https://www.npmjs.com/package/e2e) (npm, Apache-2.0): only the skill `e2e` | the `e2e` version of `packages/web-tools` |
| `infisical-ai-skills` | [`Infisical/ai-skills`](https://github.com/Infisical/ai-skills) (git, MIT): only `infisical-self-host`, `infisical-access-control`, `infisical-setup` | commit `4bd1270` |
| `emilkowalski-skills` | [`emilkowalski/skills`](https://github.com/emilkowalski/skills) (git, MIT): its web front-end skills (design engineering and animation), without `animate-expo` and `write-swift` | commit `64eb3de` |

The Magpie gateway is declared directly in Pi's `models.json` (provider `magpie`), so no provider extension is needed.
Herdr's agent manuals are not vendored: they ship inside its binaries (`hc --skill`, `herdr-app --skill`) and always
match the installed version; the `herdr` skill in `pi-agent` points to them.

## Wire into Pi

This repository is cloned at `~/.config/pi/pi-vendor`. Pi loads `~/.config/pi` as one local package (declared in
`~/.pi/agent/settings.json`), whose `package.json` (dotfiles) picks up `packages/*/skills` here. A package's extension
is added to that `package.json` by its path, after review. Then `/reload` in Pi, or restart it.

## Watch upstream

No script: upstream changes are followed through GitHub's per-path commit feeds, which only fire when a vendored path changes
(`Infisical/ai-skills` has no releases or tags, so GitHub's Watch button would never notify).

- `https://github.com/Infisical/ai-skills/commits/main/skills/infisical-setup.atom`
- `https://github.com/Infisical/ai-skills/commits/main/skills/infisical-self-host.atom`
- `https://github.com/Infisical/ai-skills/commits/main/skills/infisical-access-control.atom`

- `https://github.com/emilkowalski/skills/commits/main/skills.atom` (`emilkowalski-skills`: one feed for the whole `skills` directory, since new skills appear there)

- `https://github.com/unjs/unpdf/releases.atom` (`web`: its bundled pdf.js parses untrusted files)
- `https://github.com/FxEmbed/FxEmbed/commits/main/src/realms/api.atom` (`web`: FxTwitter's API, an external service `fetch_content` depends on)
- `https://github.com/e2e-inc/e2e/releases.atom` (`web-tools`: e2e and its web engine, and the vendored skill `e2e`)
- `https://github.com/ChromeDevTools/chrome-devtools-mcp/releases.atom` (`web-tools`: the `chrome` MCP server)

When a vendored package is added or removed, update this list.

## Update a package

Updates are always manual and reviewed:

1. `npm pack <name>@<version>` into an empty temporary directory, outside this repo.
2. Check that the tarball's sha512 matches `npm view <name>@<version> dist.integrity`.
3. Diff the new contents against `packages/<dir>/` and review: new network calls, new dependencies, install scripts, files read or written.
4. Check compatibility with the installed Pi version (APIs used, `peerDependencies`, changelog).
5. Replace `packages/<dir>/` (with only the entry's `paths` when it lists some, then record the content hash with its
   `contentSha256Method`), reapply `patches/<dir>/*.patch`, update `vendor.json`.
6. Test with `pi --list-models` and, for providers, `pi auth check --provider <id>`.
7. Commit one package update per commit. The vendored `e2e` skill documents the `e2e` binary of `packages/web-tools`:
   its version is always that binary's (`e2e --version`), so one commit updates both.

For a package taken from a git repository (`"source": "git"` in `vendor.json`), replace steps 1 and 2: clone into an
empty temporary directory, check out the pinned commit, and record the git tree IDs of the listed `paths`. Skills are
not run by Pi: review their scripts and the commands they tell the agent to run.

## Limitation

Pi does not install dependencies for local packages. A package Pi loads that has runtime `dependencies` must have its
`node_modules` vendored from a lockfile and committed (`packages/web`). Tooling that Pi does not load
(`packages/web-tools`) commits only its lockfile, and the dotfiles install its `node_modules` from it. How to update
the dependencies of one of our own packages is in its README.
