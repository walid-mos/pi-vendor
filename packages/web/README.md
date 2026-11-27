# web

Our own Pi package: the tools `web_search` and `fetch_content`. Pi loads `extensions/index.ts` by its path from
`~/.config/pi/package.json`. The code under `src/` is ours; its limits are named constants
there, each with its reason.

## External services

- `web_search` calls the `magpie-web-search` MCP server of the Magpie gateway, at the address and with the key of Pi's
  `magpie` provider. What Magpie searches with is Magpie's configuration, not this package's.
- `fetch_content` reads X posts through FxTwitter (`api.fxtwitter.com`), a third-party service: it sees the IDs of the
  posts read, and when it fails the call fails, with nothing tried in its place.

## Tests

```sh
node --test src/
```

Node runs the TypeScript files directly. Only `extensions/index.ts` imports Pi at run time, so the tests need no copy of
Pi's packages.

## Dependencies

The exact pins are in `package.json`, and `pnpm-lock.yaml` fixes the whole tree. Pi does not install dependencies for
local packages, so `node_modules/` is committed. It is produced only by:

```sh
pnpm install --prod --frozen-lockfile --ignore-scripts
```

To change a dependency: change its pin in `package.json`, run `pnpm install --ignore-scripts`, then the command above.
Review what changed in `node_modules/` as `../../AGENTS.md` says, update the `web` entry of `../../vendor.json` (each
package with its version and the lockfile's integrity), and commit the pins, the lockfile, `node_modules/` and
`vendor.json` together.

## Known limits

- Tables come out as text: `turndown` alone does not convert them.
- A PDF is parsed in Pi's own process, text only; a scan has no text layer, and there is no OCR.
- An X video is represented by its poster frame.
