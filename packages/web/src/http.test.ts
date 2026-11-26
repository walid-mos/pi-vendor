import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { isIP, type AddressInfo } from "node:net";
import { test, type TestContext } from "node:test";
import { brotliCompressSync, gzipSync } from "node:zlib";

import { WebToolError, type WebError } from "./errors.ts";
import { get, PRODUCTION, type GetOptions, type Network } from "./http.ts";

const MB = 1024 * 1024;

type Served = { url: string; requests: IncomingMessage[]; connections: () => number };

/** A local server for one test; `host` is `127.0.0.1` or `::1`. */
async function serve(t: TestContext, handler: (req: IncomingMessage, res: ServerResponse) => void, host = "127.0.0.1"): Promise<Served> {
	const requests: IncomingMessage[] = [];
	let connections = 0;
	const server = createServer((req, res) => {
		requests.push(req);
		handler(req, res);
	});
	server.on("connection", () => connections++);
	await new Promise<void>((resolve) => server.listen(0, host, resolve));
	t.after(() => {
		server.closeAllConnections();
		server.close();
	});
	const { port } = server.address() as AddressInfo;
	return { url: `http://${host.includes(":") ? `[${host}]` : host}:${port}`, requests, connections: () => connections };
}

/** A lookup that answers from a table, as dns.lookup does, in both of its forms. */
function lookupFrom(table: Record<string, string>): Network["lookup"] {
	return ((hostname: string, options: { all?: boolean }, callback: (...args: unknown[]) => void) => {
		const address = table[hostname];
		if (!address) return callback(Object.assign(new Error(`getaddrinfo ENOTFOUND ${hostname}`), { code: "ENOTFOUND" }));
		if (options.all) return callback(null, [{ address, family: isIP(address) }]);
		return callback(null, address, isIP(address));
	}) as Network["lookup"];
}

/** Test network: only the local servers' 127.0.0.1 is allowed, every other address is refused. */
function testNetwork(table: Record<string, string> = {}): Network {
	return { isAllowedAddress: (ip) => ip === "127.0.0.1", lookup: lookupFrom(table) };
}

const options = (more: Partial<GetOptions> = {}): GetOptions => ({
	timeoutMs: 5000,
	maxRedirects: 5,
	limitFor: () => 5 * MB,
	accept: "*/*",
	...more,
});

async function failure(promise: Promise<unknown>): Promise<WebError> {
	try {
		await promise;
	} catch (thrown) {
		if (thrown instanceof WebToolError) return thrown.error;
		throw thrown;
	}
	assert.fail("the request succeeded");
}

/** /r/<n> redirects to /r/<n-1>; /r/0 answers "done". */
function redirects(req: IncomingMessage, res: ServerResponse): void {
	const n = Number(req.url?.split("/")[2]);
	if (n === 0) return void res.end("done");
	res.writeHead(302, { Location: `/r/${n - 1}` }).end();
}

test("follows 5 redirects and returns the chain", async (t) => {
	const s = await serve(t, redirects);
	const got = await get(new URL(`${s.url}/r/5`), options(), testNetwork());
	assert.equal(got.finalUrl, `${s.url}/r/0`);
	assert.deepEqual(got.redirects, [`${s.url}/r/5`, `${s.url}/r/4`, `${s.url}/r/3`, `${s.url}/r/2`, `${s.url}/r/1`]);
	assert.equal(got.body.toString(), "done");
});

test("the 6th redirect gives too_many_redirects", async (t) => {
	const s = await serve(t, redirects);
	const error = await failure(get(new URL(`${s.url}/r/6`), options(), testNetwork()));
	assert.deepEqual(error, {
		kind: "too_many_redirects",
		limit: 5,
		chain: [`${s.url}/r/6`, `${s.url}/r/5`, `${s.url}/r/4`, `${s.url}/r/3`, `${s.url}/r/2`, `${s.url}/r/1`, `${s.url}/r/0`],
	});
	assert.equal(s.requests.length, 6, "the 7th URL is not requested");
});

test("with a limit of 3, the 4th redirect gives too_many_redirects", async (t) => {
	const s = await serve(t, redirects);
	assert.equal((await get(new URL(`${s.url}/r/3`), options({ maxRedirects: 3 }), testNetwork())).redirects.length, 3);
	const error = await failure(get(new URL(`${s.url}/r/4`), options({ maxRedirects: 3 }), testNetwork()));
	assert.equal(error.kind, "too_many_redirects");
});

test("a redirect to ftp: gives invalid_url", async (t) => {
	const s = await serve(t, (_req, res) => res.writeHead(301, { Location: "ftp://example.com/file" }).end());
	assert.deepEqual(await failure(get(new URL(s.url), options(), testNetwork())), {
		kind: "invalid_url",
		url: "ftp://example.com/file",
		reason: "only http and https are read",
	});
});

test("a Location that is not a URL gives invalid_url", async (t) => {
	const s = await serve(t, (_req, res) => res.writeHead(302, { Location: "http://[" }).end());
	assert.deepEqual(await failure(get(new URL(s.url), options(), testNetwork())), { kind: "invalid_url", url: "http://[", reason: "not a URL" });
});

test("a redirect to a refused address gives blocked_address, and that target receives no request", async (t) => {
	const target = await serve(t, (_req, res) => res.end("secret"), "::1");
	const s = await serve(t, (_req, res) => res.writeHead(302, { Location: `${target.url}/admin` }).end());
	assert.deepEqual(await failure(get(new URL(s.url), options(), testNetwork())), { kind: "blocked_address", host: "::1", address: "::1" });
	assert.equal(target.connections(), 0);
});

test("with the production policy, a name that resolves to 127.0.0.1 is refused before any connection", async (t) => {
	const s = await serve(t, (_req, res) => res.end("secret"));
	const port = new URL(s.url).port;
	const network: Network = { isAllowedAddress: PRODUCTION.isAllowedAddress, lookup: lookupFrom({ "rebind.example": "127.0.0.1" }) };
	assert.deepEqual(await failure(get(new URL(`http://rebind.example:${port}/`), options(), network)), {
		kind: "blocked_address",
		host: "rebind.example",
		address: "127.0.0.1",
	});
	assert.equal(s.connections(), 0);
});

test("a name that does not resolve gives dns_failed", async () => {
	assert.deepEqual(await failure(get(new URL("http://nowhere.example/"), options(), testNetwork())), {
		kind: "dns_failed",
		host: "nowhere.example",
		code: "ENOTFOUND",
	});
});

test("a redirect to a name that does not resolve gives dns_failed with that name", async (t) => {
	const s = await serve(t, (_req, res) => res.writeHead(302, { Location: "http://nowhere.example/" }).end());
	assert.deepEqual(await failure(get(new URL(s.url), options(), testNetwork())), { kind: "dns_failed", host: "nowhere.example", code: "ENOTFOUND" });
});

test("a body over the limit gives too_large", async (t) => {
	const s = await serve(t, (_req, res) => res.end(Buffer.alloc(6 * MB)));
	assert.deepEqual(await failure(get(new URL(s.url), options(), testNetwork())), { kind: "too_large", limitBytes: 5 * MB });
});

test("a small gzip body that inflates past the limit gives too_large", async (t) => {
	const bomb = gzipSync(Buffer.alloc(6 * MB));
	assert.ok(bomb.length < 100_000);
	const s = await serve(t, (_req, res) => res.writeHead(200, { "Content-Encoding": "gzip" }).end(bomb));
	assert.deepEqual(await failure(get(new URL(s.url), options(), testNetwork())), { kind: "too_large", limitBytes: 5 * MB });
});

test("a Content-Length over the limit fails before the body is read", async (t) => {
	// The body never comes: without the header check, this request would end in a timeout instead.
	const s = await serve(t, (_req, res) => res.writeHead(200, { "Content-Length": String(100 * MB) }).flushHeaders());
	assert.deepEqual(await failure(get(new URL(s.url), options(), testNetwork())), { kind: "too_large", limitBytes: 5 * MB });
});

test("the size limit is chosen from the content type", async (t) => {
	const s = await serve(t, (req, res) => res.writeHead(200, { "Content-Type": req.url === "/doc.pdf" ? "application/pdf" : "text/html" }).end(Buffer.alloc(6 * MB)));
	const limitFor = (contentType: string) => (contentType === "application/pdf" ? 25 * MB : 5 * MB);
	const pdf = await get(new URL(`${s.url}/doc.pdf`), options({ limitFor }), testNetwork());
	assert.equal(pdf.body.length, 6 * MB);
	assert.equal(pdf.contentType, "application/pdf");
	assert.deepEqual(await failure(get(new URL(`${s.url}/page`), options({ limitFor }), testNetwork())), { kind: "too_large", limitBytes: 5 * MB });
});

test("a binary body is returned byte for byte", async (t) => {
	const bytes = Buffer.from(Array.from({ length: 4096 }, (_, i) => i % 256));
	const s = await serve(t, (_req, res) => res.writeHead(200, { "Content-Type": "application/octet-stream" }).end(bytes));
	assert.deepEqual((await get(new URL(s.url), options(), testNetwork())).body, bytes);
});

test("with a host allowlist, a first URL outside it gives media_host_blocked and no request", async (t) => {
	const s = await serve(t, (_req, res) => res.end("image"));
	const port = new URL(s.url).port;
	const network = testNetwork({ "other.example": "127.0.0.1" });
	const allowHost = (host: string) => host === "media.example";
	assert.deepEqual(await failure(get(new URL(`http://other.example:${port}/a.png`), options({ allowHost }), network)), {
		kind: "media_host_blocked",
		host: "other.example",
	});
	assert.equal(s.connections(), 0);
});

test("with a host allowlist, a redirect outside it gives media_host_blocked and that host receives no request", async (t) => {
	const outside = await serve(t, (_req, res) => res.end("image"));
	const outsidePort = new URL(outside.url).port;
	const media = await serve(t, (_req, res) => res.writeHead(302, { Location: `http://other.example:${outsidePort}/a.png` }).end());
	const network = testNetwork({ "media.example": "127.0.0.1", "other.example": "127.0.0.1" });
	const allowHost = (host: string) => host === "media.example";
	const start = new URL(`http://media.example:${new URL(media.url).port}/a.png`);
	assert.deepEqual(await failure(get(start, options({ allowHost }), network)), { kind: "media_host_blocked", host: "other.example" });
	assert.equal(outside.connections(), 0);
});

test("gzip and brotli bodies are decoded", async (t) => {
	const text = "<p>héllo</p>".repeat(100);
	const s = await serve(t, (req, res) => {
		if (req.url === "/gzip") res.writeHead(200, { "Content-Encoding": "gzip" }).end(gzipSync(text));
		else res.writeHead(200, { "Content-Encoding": "br" }).end(brotliCompressSync(text));
	});
	assert.equal((await get(new URL(`${s.url}/gzip`), options(), testNetwork())).body.toString(), text);
	assert.equal((await get(new URL(`${s.url}/br`), options(), testNetwork())).body.toString(), text);
});

test("a stalled server gives timeout at the deadline", async (t) => {
	const s = await serve(t, () => {});
	assert.deepEqual(await failure(get(new URL(s.url), options({ timeoutMs: 200 }), testNetwork())), { kind: "timeout", afterMs: 200 });
});

test("the caller's abort gives aborted", async (t) => {
	const s = await serve(t, () => {});
	const controller = new AbortController();
	setTimeout(() => controller.abort(), 50);
	assert.deepEqual(await failure(get(new URL(s.url), options({ signal: controller.signal }), testNetwork())), { kind: "aborted" });
});

test("a 404 gives http_status with the server's body", async (t) => {
	const s = await serve(t, (_req, res) => res.writeHead(404).end("missing"));
	assert.deepEqual(await failure(get(new URL(`${s.url}/gone`), options(), testNetwork())), {
		kind: "http_status",
		status: 404,
		url: `${s.url}/gone`,
		body: { state: "read", text: "missing" },
	});
});

test("an error status's body is decoded like any body", async (t) => {
	const s = await serve(t, (_req, res) => res.writeHead(404, { "Content-Encoding": "gzip" }).end(gzipSync("missing")));
	assert.deepEqual((await failure(get(new URL(s.url), options(), testNetwork()))).body, { state: "read", text: "missing" });
});

test("an error status's body that cannot be decoded is reported unreadable, with the status kept", async (t) => {
	const s = await serve(t, (_req, res) => res.writeHead(404, { "Content-Encoding": "zstd" }).end("x"));
	assert.deepEqual(await failure(get(new URL(s.url), options(), testNetwork())), {
		kind: "http_status",
		status: 404,
		url: `${s.url}/`,
		body: { state: "unreadable", reason: "Network error (unsupported_encoding): the server sent Content-Encoding zstd" },
	});
});

/** Sends the headers and a first chunk of a body that never ends; says whether the client drops the connection. */
function stallAfterHeaders(res: ServerResponse, status: number, headers: Record<string, string> = {}): Promise<boolean> {
	res.writeHead(status, headers);
	res.write("the body never ends");
	return new Promise((resolve) => {
		const timer = setTimeout(() => resolve(false), 1000);
		res.on("close", () => {
			clearTimeout(timer);
			resolve(true);
		});
	});
}

test("the body of a redirect is not read: the client drops that connection", async (t) => {
	let dropped: Promise<boolean> | undefined;
	const s = await serve(t, (req, res) => {
		if (req.url === "/final") return void res.end("ok");
		dropped = stallAfterHeaders(res, 302, { Location: "/final" });
	});
	await get(new URL(`${s.url}/start`), options({ timeoutMs: 10_000 }), testNetwork());
	assert.equal(await dropped, true);
});

test("the body of an error status is read up to 2000 bytes, then the client drops the connection", async (t) => {
	let dropped: Promise<boolean> | undefined;
	const s = await serve(t, (_req, res) => {
		res.writeHead(500);
		res.write("x".repeat(3000));
		dropped = new Promise((resolve) => {
			const timer = setTimeout(() => resolve(false), 1000);
			res.on("close", () => {
				clearTimeout(timer);
				resolve(true);
			});
		});
	});
	const error = await failure(get(new URL(s.url), options({ timeoutMs: 10_000 }), testNetwork()));
	assert.deepEqual(error, { kind: "http_status", status: 500, url: `${s.url}/`, body: { state: "cut", text: "x".repeat(2000) } });
	assert.equal(await dropped, true);
});

const refusedAfterHeaders: [string, Record<string, string>, Partial<GetOptions>, WebError][] = [
	[
		"a Content-Encoding it cannot decode",
		{ "Content-Encoding": "zstd" },
		{},
		{ kind: "network", code: "unsupported_encoding", message: "the server sent Content-Encoding zstd" },
	],
	[
		"a content type its limit function refuses",
		{ "Content-Type": "application/x-nope" },
		{
			limitFor: () => {
				throw new WebToolError({ kind: "unsupported_content_type", contentType: "application/x-nope" });
			},
		},
		{ kind: "unsupported_content_type", contentType: "application/x-nope" },
	],
];

for (const [name, headers, more, expected] of refusedAfterHeaders) {
	test(`${name}: the client drops the connection`, async (t) => {
		let dropped: Promise<boolean> | undefined;
		const s = await serve(t, (_req, res) => {
			dropped = stallAfterHeaders(res, 200, headers);
		});
		assert.deepEqual(await failure(get(new URL(s.url), options({ timeoutMs: 10_000, ...more }), testNetwork())), expected);
		assert.equal(await dropped, true);
	});
}

test("a connection refused on every address of a name says which addresses", async () => {
	const probe = createServer();
	await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
	const { port } = probe.address() as AddressInfo;
	await new Promise((resolve) => probe.close(resolve));
	const lookup = ((_hostname: string, _options: object, callback: (...args: unknown[]) => void) =>
		callback(null, [
			{ address: "::1", family: 6 },
			{ address: "127.0.0.1", family: 4 },
		])) as Network["lookup"];
	const error = await failure(get(new URL(`http://dual.example:${port}/`), options(), { isAllowedAddress: () => true, lookup }));
	assert.ok(error.kind === "network" && error.message.includes("::1") && error.message.includes("127.0.0.1"), JSON.stringify(error));
});

test("the server sees the generic User-Agent and neither Cookie nor Authorization", async (t) => {
	const s = await serve(t, (_req, res) => res.writeHead(302, { "Set-Cookie": "id=1", Location: "/next" }).end());
	await failure(get(new URL(s.url), options({ maxRedirects: 1 }), testNetwork()));
	assert.equal(s.requests.length, 2);
	for (const req of s.requests) {
		assert.equal(req.headers["user-agent"], "Mozilla/5.0 (compatible; pi-web/1.0)");
		assert.equal(req.headers.cookie, undefined);
		assert.equal(req.headers.authorization, undefined);
	}
});

test("with httpsOnly, an http: URL gives invalid_url, and it receives no request", async (t) => {
	const plain = await serve(t, (_req, res) => res.end("image"));
	assert.deepEqual(await failure(get(new URL(`${plain.url}/a.png`), options({ httpsOnly: true }), testNetwork())), {
		kind: "invalid_url",
		url: `${plain.url}/a.png`,
		reason: "only https is read here",
	});
	assert.equal(plain.connections(), 0);
});
