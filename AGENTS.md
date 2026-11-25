# Rules for pi-vendor

- Public repository of third-party code: `packages/<dir>/` holds upstream contents with `patches/<dir>/` applied.
  Never edit `packages/` by hand; a local change is a patch in `patches/<dir>/`, applied the way the README describes.
- Adding or updating a package follows the README's "Update a package" procedure, one package per commit, with
  `vendor.json` (source, pin, integrity, review notes) updated in the same commit.
- Review before anything loads: network calls, dependencies, install scripts, files read or written, and for skills
  the commands they tell the agent to run.
- Pi loads the skills of every package here through `~/.config/pi/package.json` (dotfiles). A package's extension
  loads only once its path is added there, after the review.
- Keep the README's package table and "Watch upstream" feeds aligned with `vendor.json`.
- Nothing private here: no client name, no homelab value, no secret.
