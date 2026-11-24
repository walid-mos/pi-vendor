# pi-vendor

Vendored third-party [Pi](https://github.com/earendil-works/pi) packages, reviewed and pinned.

Pi loads each package from this checkout as a local package, so nothing is fetched from npm at runtime and nothing changes without a reviewed commit here.

## Layout

```
vendor.json          # source, version, integrity and review notes for each package
packages/<dir>/      # exact contents of the published tarball, never edited by hand
local/<dir>/         # our own packages (not published), reviewed like the others
patches/<dir>/       # local changes, applied on top of packages/<dir> after each update
```

## Packages

None at the moment. The Magpie gateway is declared directly in Pi's `models.json` (provider `magpie`), so no
third-party provider extension is needed.

## Local packages

Written for this setup, not published. Same review rule: read in full, no runtime dependency, network calls listed in `vendor.json`.

| Dir | What | Version |
|---|---|---|
| `local/decide` | tool `decide`: closed questions (choice, yes/no, rating) answered by Jev through Magpie `group/decide` | 0.2.0 |

## Wire into Pi

In `~/.pi/agent/settings.json` (tracked in the `pi-agent` repo):

```json
{ "packages": ["~/.config/pi-vendor/local/decide"] }
```

Then `/reload` in Pi, or restart it.

## Update a package

Updates are always manual and reviewed:

1. `npm pack <name>@<version>` into an empty temporary directory, outside this repo.
2. Check that the tarball's sha512 matches `npm view <name>@<version> dist.integrity`.
3. Diff the new contents against `packages/<dir>/` and review: new network calls, new dependencies, install scripts, files read or written.
4. Check compatibility with the installed Pi version (APIs used, `peerDependencies`, changelog).
5. Replace `packages/<dir>/`, reapply `patches/<dir>/*.patch`, update `vendor.json`.
6. Test with `pi --list-models` and, for providers, `pi auth check --provider <id>`.
7. Commit one package update per commit.

## Limitation

Pi does not install dependencies for local packages. A package with runtime `dependencies` must have its `node_modules` vendored from a lockfile.
