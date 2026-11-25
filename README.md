# pi-vendor

Vendored third-party [Pi](https://github.com/earendil-works/pi) packages, reviewed and pinned.

Pi loads each package from this checkout as a local package, so nothing is fetched from npm at runtime and nothing changes without a reviewed commit here.

## Layout

```
vendor.json          # source, pinned version or commit, integrity and review notes for each package
packages/<dir>/      # upstream contents (npm tarball, or the listed paths of a git commit) with patches/<dir> applied, never edited by hand
patches/<dir>/       # local changes, applied on top of packages/<dir> after each update
```

## Packages

| Dir | Upstream | Version |
|---|---|---|
| `infisical-ai-skills` | [`Infisical/ai-skills`](https://github.com/Infisical/ai-skills) (git, MIT): only `infisical-self-host`, `infisical-access-control`, `infisical-setup` | commit `4bd1270` |

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

When a vendored package is added or removed, update this list.

## Update a package

Updates are always manual and reviewed:

1. `npm pack <name>@<version>` into an empty temporary directory, outside this repo.
2. Check that the tarball's sha512 matches `npm view <name>@<version> dist.integrity`.
3. Diff the new contents against `packages/<dir>/` and review: new network calls, new dependencies, install scripts, files read or written.
4. Check compatibility with the installed Pi version (APIs used, `peerDependencies`, changelog).
5. Replace `packages/<dir>/`, reapply `patches/<dir>/*.patch`, update `vendor.json`.
6. Test with `pi --list-models` and, for providers, `pi auth check --provider <id>`.
7. Commit one package update per commit.

For a package taken from a git repository (`"source": "git"` in `vendor.json`), replace steps 1 and 2: clone into an
empty temporary directory, check out the pinned commit, copy only the listed `paths`, and record the git tree IDs and
the content hash (`contentSha256Method`). Skills are not run by Pi: review their scripts and the commands they tell
the agent to run.

## Limitation

Pi does not install dependencies for local packages. A package with runtime `dependencies` must have its `node_modules` vendored from a lockfile.
