# Fixtures

Public data only. The HTML pages are written for the tests. The PDFs are made once by `make-pdf-fixtures.swift`
(how to run it is at its top), from text written for the tests. The `magpie-*.json` files are replies of Magpie's
`magpie-web-search` MCP server, recorded on 2026-11-26, with every private value replaced:

- `magpie-searxng-down.json`: the SearXNG address is `searxng.internal:8080`.
- `magpie-jsonrpc-refused.json`: written after the refusal Magpie's hub sent for a key that may not use a server, the
  same JSON-RPC error with this server's and tool's names, and the key's name replaced by `example`.

The Instagram, Threads and TikTok pages are public pages fetched on 2026-11-26 with a plain GET, trimmed to the
`<title>` and `og:` tags of their `<head>`, with the signature query strings of their image URLs removed.
