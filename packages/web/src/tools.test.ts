import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { rmSync } from "node:fs";
import { dirname } from "node:path";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { isIP, type AddressInfo } from "node:net";
import { test, type TestContext } from "node:test";

import type { Network } from "./http.ts";
import { createWebTools, type WebToolsDeps } from "./tools.ts";

const fixture = (name: string) => readFileSync(new URL(`fixtures/${name}`, import.meta.url));
const json = (name: string): Record<string, any> => JSON.parse(fixture(name).toString("utf8"));

type Server = { origin: string; port: string; requests: IncomingMessage[] };

async function serve(t: TestContext, handler: (req: IncomingMessage, res: ServerResponse, body: string) => void): Promise<Server> {
	const requests: IncomingMessage[] = [];
	const server = createServer(async (req, res) => {
		let body = "";
		for await (const chunk of req) body += chunk;
		requests.push(req);
		handler(req, res, body);
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	t.after(() => {
		server.closeAllConnections();
		server.close();
	});
	const port = String((server.address() as AddressInfo).port);
	return { origin: `http://127.0.0.1:${port}`, port, requests };
}

/** Names that resolve to the local servers; every lookup is recorded. */
function network(names: string[], looked: string[] = []): Network {
	const lookup = ((hostname: string, options: { all?: boolean }, callback: (...args: unknown[]) => void) => {
		looked.push(hostname);
		if (!names.includes(hostname)) return callback(Object.assign(new Error(`ENOTFOUND ${hostname}`), { code: "ENOTFOUND" }));
		return options.all ? callback(null, [{ address: "127.0.0.1", family: isIP("127.0.0.1") }]) : callback(null, "127.0.0.1", 4);
	}) as Network["lookup"];
	return { isAllowedAddress: (ip) => ip === "127.0.0.1", lookup };
}

const UNDECODABLE = Buffer.from("not an image");

function deps(more: Partial<WebToolsDeps> = {}): WebToolsDeps {
	return {
		magpie: async () => ({ baseUrl: "http://127.0.0.1:1/v1", key: "sk-test" }),
		network: network([]),
		media: { network: network(["media.example"]), isAllowedHost: (host) => host === "media.example", httpsOnly: false },
		fxtwitter: "http://127.0.0.1:1",
		resizeImage: async (bytes) => (Buffer.from(bytes).equals(UNDECODABLE) ? null : { data: Buffer.from("resized").toString("base64"), mimeType: "image/jpeg", width: 10, height: 8 }),
		outputLimits: { maxBytes: 50 * 1024, maxLines: 2000 },
		...more,
	};
}

type Result = { content: ({ type: "text"; text: string } | { type: "image"; data: string; mimeType: string })[]; details: any; isError?: boolean };

async function run(d: WebToolsDeps, name: "web_search" | "fetch_content", params: Record<string, unknown>): Promise<Result> {
	const tool = createWebTools(d).find((t) => t.name === name);
	assert.ok(tool, name);
	return (await tool.execute("call-1", params as never, undefined, undefined, {} as never)) as Result;
}

const text = (result: Result) => result.content.filter((c) => c.type === "text").map((c) => (c as { text: string }).text).join("\n");

// web_search

test("web_search without a key returns gateway_missing naming auth.json, and Magpie receives no request", async (t) => {
	const magpie = await serve(t, (_req, res) => res.end("{}"));
	const result = await run(deps({ magpie: async () => ({ baseUrl: `${magpie.origin}/v1`, key: undefined }) }), "web_search", { query: "tides" });
	assert.equal(result.isError, true);
	assert.equal(result.details.ok, false);
	assert.equal(result.details.error.kind, "gateway_missing");
	assert.match(text(result), /auth\.json/);
	assert.equal(magpie.requests.length, 0);
});

test("a successful search returns Magpie's text and details with the query", async (t) => {
	const magpie = await serve(t, (_req, res) => res.writeHead(200, { "Content-Type": "application/json" }).end(fixture("magpie-search-ok.json")));
	const result = await run(deps({ magpie: async () => ({ baseUrl: `${magpie.origin}/v1`, key: "sk-test" }) }), "web_search", { query: "rule of twelfths tide", count: 2 });
	assert.equal(result.isError, undefined);
	assert.ok(text(result).startsWith("1. Rule of twelfths - Wikipedia — https://en.wikipedia.org/wiki/Rule_of_twelfths"));
	assert.deepEqual({ ok: result.details.ok, query: result.details.query, count: result.details.count, truncated: result.details.truncated }, { ok: true, query: "rule of twelfths tide", count: 2, truncated: false });
});

// fetch_content: generic pages

const pages = (t: TestContext) =>
	serve(t, (req, res) => {
		switch (req.url) {
			case "/article":
				return res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(fixture("article.html"));
			case "/moved":
				return res.writeHead(301, { Location: "/article" }).end();
			case "/data.json":
				return res.writeHead(200, { "Content-Type": "application/json" }).end('{"tide":"high"}');
			case "/photo.png":
				return res.writeHead(200, { "Content-Type": "image/png" }).end(Buffer.from([0x89, 0x50]));
			case "/doc.pdf":
				return res.writeHead(200, { "Content-Type": "application/pdf" }).end(fixture("two-pages.pdf"));
			case "/download":
				return res.writeHead(200, { "Content-Type": "application/octet-stream" }).end(fixture("two-pages.pdf"));
			case "/blob":
				return res.writeHead(200, { "Content-Type": "application/octet-stream" }).end(Buffer.from("PK\x03\x04 a zip"));
			case "/long":
				return res.writeHead(200, { "Content-Type": "text/plain" }).end(Array.from({ length: 50 }, (_, i) => `line ${i + 1}`).join("\n"));
			default:
				return res.writeHead(404).end();
		}
	});

test("fetch_content on an article returns its title, the source line and the markdown", async (t) => {
	const s = await pages(t);
	const result = await run(deps(), "fetch_content", { url: `${s.origin}/article` });
	assert.equal(result.details.kind, "article");
	assert.match(text(result), /^# Tides of the North Sea\n/);
	assert.match(text(result), new RegExp(`^Source: ${s.origin}/article$`, "m"));
	assert.match(text(result), /^By Ada Marlow, 2026-03-14T09:30:00Z$/m);
	assert.match(text(result), /^## Reading a tide table$/m);
});

test("a redirect is reported in finalUrl and redirects, and in the source line", async (t) => {
	const s = await pages(t);
	const result = await run(deps(), "fetch_content", { url: `${s.origin}/moved` });
	assert.equal(result.details.finalUrl, `${s.origin}/article`);
	assert.deepEqual(result.details.redirects, [`${s.origin}/moved`]);
	assert.match(text(result), new RegExp(`^Source: ${s.origin}/article \\(redirected from ${s.origin}/moved\\)$`, "m"));
});

test("JSON is returned as text; an image gives unsupported_content_type", async (t) => {
	const s = await pages(t);
	const data = await run(deps(), "fetch_content", { url: `${s.origin}/data.json` });
	assert.equal(data.details.kind, "text");
	assert.match(text(data), /\{"tide":"high"\}/);
	const image = await run(deps(), "fetch_content", { url: `${s.origin}/photo.png` });
	assert.equal(image.isError, true);
	assert.deepEqual(image.details.error, { kind: "unsupported_content_type", contentType: "image/png" });
});

test("a PDF returns its sentences and both page counts, also when served as octet-stream", async (t) => {
	const s = await pages(t);
	for (const path of ["/doc.pdf", "/download"]) {
		const result = await run(deps(), "fetch_content", { url: `${s.origin}${path}` });
		assert.equal(result.details.kind, "pdf", path);
		assert.match(text(result), /The first page says the harbour opens at dawn\./);
		assert.deepEqual([result.details.pagesTotal, result.details.pagesExtracted], [2, 2]);
		assert.equal(result.details.title, "Harbour Notes");
	}
	const blob = await run(deps(), "fetch_content", { url: `${s.origin}/blob` });
	assert.deepEqual(blob.details.error, { kind: "unsupported_content_type", contentType: "application/octet-stream" });
});

test("an over-long page sets truncated and fullOutputPath", async (t) => {
	const s = await pages(t);
	const result = await run(deps({ outputLimits: { maxBytes: 50 * 1024, maxLines: 10 } }), "fetch_content", { url: `${s.origin}/long` });
	try {
		assert.equal(result.details.truncated, true);
		assert.ok(text(result).trimEnd().endsWith(result.details.fullOutputPath));
	} finally {
		rmSync(dirname(result.details.fullOutputPath), { recursive: true });
	}
});

test("a local address is refused with blocked_address, naming e2e", async () => {
	const result = await run(deps({ network: { isAllowedAddress: () => false, lookup: network([]).lookup } }), "fetch_content", { url: "http://localhost:5175/" });
	assert.equal(result.details.error.kind, "blocked_address");
	assert.match(text(result), /\be2e\b/);
});

// fetch_content: X posts

function postWithPhotos(mediaPort: string) {
	const thread = json("x/thread-text.json");
	thread.status.media = {
		photos: [
			{ type: "photo", url: `http://media.example:${mediaPort}/ok.jpg`, width: 100, height: 80, altText: "a harbour at dawn" },
			{ type: "photo", url: `http://media.example:${mediaPort}/gone.jpg`, width: 100, height: 80 },
		],
	};
	return thread;
}

const media = (t: TestContext) =>
	serve(t, (req, res) => {
		if (req.url === "/ok.jpg") return res.writeHead(200, { "Content-Type": "image/jpeg" }).end(Buffer.from([0xff, 0xd8, 1]));
		if (req.url === "/bad.jpg") return res.writeHead(200, { "Content-Type": "image/jpeg" }).end(UNDECODABLE);
		return res.writeHead(404).end();
	});

test("an X post with two photos, one missing: the text, then exactly one image; the missing one is named with its reason", async (t) => {
	const m = await media(t);
	const fx = await serve(t, (req, res) => res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(req.url === "/2/thread/20" ? postWithPhotos(m.port) : {})));
	const result = await run(deps({ fxtwitter: fx.origin }), "fetch_content", { url: "https://x.com/jack/status/20" });
	assert.deepEqual(result.content.map((c) => c.type), ["text", "image"]);
	assert.deepEqual(result.content[1], { type: "image", data: Buffer.from("resized").toString("base64"), mimeType: "image/jpeg" });
	assert.match(text(result), /^- photo 1: a harbour at dawn$/m);
	assert.match(text(result), /^- photo 2: not attached \(HTTP 404 from http:\/\/media\.example:\d+\/gone\.jpg\.\)$/m);
	assert.equal(result.details.kind, "x_status");
	assert.deepEqual(
		result.details.media.map((x: { label: string; state: string; error?: { kind: string } }) => [x.label, x.state, x.error?.kind]),
		[
			["photo 1", "attached", undefined],
			["photo 2", "failed", "http_status"],
		],
	);
	assert.deepEqual([result.details.media[0].width, result.details.media[0].height], [10, 8]);
});

test("a photo the resizer cannot decode is failed with image_undecodable", async (t) => {
	const m = await media(t);
	const thread = postWithPhotos(m.port);
	thread.status.media.photos = [{ type: "photo", url: `http://media.example:${m.port}/bad.jpg`, width: 1, height: 1 }];
	const fx = await serve(t, (_req, res) => res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(thread)));
	const result = await run(deps({ fxtwitter: fx.origin }), "fetch_content", { url: "https://x.com/jack/status/20" });
	assert.deepEqual(result.content.map((c) => c.type), ["text"]);
	assert.equal(result.details.media[0].state, "failed");
	assert.equal(result.details.media[0].error.kind, "image_undecodable");
});

test("FxTwitter answering 500 gives x_unavailable, and the X page itself is never requested", async (t) => {
	const fx = await serve(t, (_req, res) => res.writeHead(500).end("oops"));
	const looked: string[] = [];
	const result = await run(deps({ fxtwitter: fx.origin, network: network([], looked) }), "fetch_content", { url: "https://x.com/jack/status/20" });
	assert.equal(result.isError, true);
	assert.equal(result.details.error.kind, "x_unavailable");
	assert.match(text(result), /FxTwitter/);
	assert.deepEqual(looked, [], "no lookup of x.com");
});

test("replies: true on an X post adds the replies", async (t) => {
	const fx = await serve(t, (req, res) => {
		const body = req.url === "/2/thread/2124467552441012653" ? fixture("x/thread-photos.json") : fixture("x/conversation-photos.json");
		res.writeHead(200, { "Content-Type": "application/json" }).end(body);
	});
	const result = await run(deps({ fxtwitter: fx.origin, media: { ...deps().media, isAllowedHost: () => false } }), "fetch_content", {
		url: "https://x.com/SpaceX/status/2124467552441012653",
		replies: true,
	});
	assert.equal(result.details.replies, 20);
	assert.match(text(result), /^Replies, 20 shown:$/m);
	assert.deepEqual(
		fx.requests.map((r) => r.url),
		["/2/thread/2124467552441012653", "/2/conversation/2124467552441012653"],
	);
});

test("replies: true on an article URL gives option_not_supported, and no request is made", async (t) => {
	const s = await pages(t);
	const result = await run(deps(), "fetch_content", { url: `${s.origin}/article`, replies: true });
	assert.equal(result.details.error.kind, "option_not_supported");
	assert.equal(s.requests.length, 0);
});

// fetch_content: social hosts

test("a social host returns its metadata; the same host with mode page returns the page", async (t) => {
	const ig = await serve(t, (_req, res) => res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(fixture("instagram-profile.html")));
	const d = deps({ network: network(["www.instagram.com"]) });
	const meta = await run(d, "fetch_content", { url: `http://www.instagram.com:${ig.port}/nasa/` });
	assert.equal(meta.details.kind, "social_meta");
	assert.equal(meta.details.meta.title, "NASA (@nasa) • Instagram photos and videos");
	assert.match(text(meta), /metadata only/);
	assert.match(text(meta), /\be2e\b/);
	const page = await run(d, "fetch_content", { url: `http://www.instagram.com:${ig.port}/nasa/`, mode: "page" });
	assert.equal(page.details.kind, "page");
});
