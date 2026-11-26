// The page an e2e session opens on: e2e gives a session of a config no URL, so the first action is `navigate`.
// usage: node start-page.mjs <port>. It serves one small page on 127.0.0.1 and that port, for every path, until killed.
// Its title is read from start-page-title.txt beside it, the file pi-chromium reads to tell this page from a real one.
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";

const port = Number(process.argv[2]);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
	console.error("usage: start-page.mjs <port>");
	process.exit(2);
}
const titleFile = join(import.meta.dirname, "start-page-title.txt");
let title;
try {
	title = readFileSync(titleFile, "utf8").trim();
} catch (error) {
	console.error(`start-page: cannot read ${titleFile}: ${error.message}`);
	process.exit(1);
}
const body = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title></head><body><h1>${title}</h1><p>Call navigate with the URL to open.</p></body></html>`;
createServer((_req, res) => res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(body)).listen(port, "127.0.0.1");
