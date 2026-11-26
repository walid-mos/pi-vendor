# Rules for pi-vendor

- Public repository of Pi packages: third-party packages, reviewed and pinned, and two packages of our own.
- A third-party package's `packages/<dir>/` holds upstream contents with `patches/<dir>/` applied. Never edit it by
  hand; a local change is a patch in `patches/<dir>/`, applied the way the README describes.
- Our own packages have code that is ours, edited directly, test first. Nothing a run produces is committed in them.
  - `packages/web` is a Pi package that Pi loads. Its `node_modules/` is third-party and committed, because Pi does
    not install dependencies for local packages: produced only from its lockfile, never edited by hand, and reviewed
    like a vendored package.
  - `packages/web-tools` is tooling that Pi does not load: e2e and the MCP servers run from it. Its `pnpm-lock.yaml`
    is committed and is the only place the versions of its tools are written. Its `node_modules/` is not committed
    (platform-specific native bindings, size): the dotfiles install it from the frozen lockfile. A version change is
    reviewed like a vendored package update.
- Adding or updating a package follows the README's "Update a package" procedure, one package per commit, with
  `vendor.json` (source, pin, integrity, review notes) updated in the same commit. One exception: the vendored e2e
  skill (`packages/e2e`) and the `e2e` pin of `packages/web-tools` are updated in one commit, because the skill
  documents that binary.
- Review before anything loads: network calls, dependencies, install scripts, files read or written, and for skills
  the commands they tell the agent to run.
- Pi loads the skills of every package here through `~/.config/pi/package.json` (dotfiles). A package's extension
  loads only once its path is added there, after the review.
- Keep the README's package table and "Watch upstream" feeds aligned with `vendor.json`.
- Nothing private here: no client name, no homelab value, no secret.
