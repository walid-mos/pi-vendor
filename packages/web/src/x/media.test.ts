import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { isIP, type AddressInfo } from "node:net";
import { test, type TestContext } from "node:test";

import { WebToolError, type WebError } from "../errors.ts";
import type { Network } from "../http.ts";
import { collectMedia, downloadImage, isMediaHost, MAX_IMAGE_BYTES, type MediaDeps } from "./media.ts";
import type { XPost, XStatus } from "./payload.ts";

function status(id: string, more: Partial<XStatus> = {}): XStatus {
	return { kind: "status", id, url: `https://x.com/u/status/${id}`, author: { handle: "u" }, text: "t", engagement: {}, media: [], ...more };
}

function post(root: XStatus, thread: XStatus[] = []): XPost {
	return { root, thread, dropped: { quotes: 0, thread: 0, replies: 0 } };
}

const img = (name: string) => `https://pbs.twimg.com/media/${name}.jpg`;

test("photos, then GIFs, then video posters, then the card image, each labelled, with alt text", () => {
	const root = status("1", {
		media: [
			{ kind: "photo", url: img("p1"), altText: "a harbour" },
			{ kind: "video", posterUrl: img("v1"), durationS: 12 },
			{ kind: "gif", url: img("g1") },
			{ kind: "photo", url: img("p2") },
		],
		cardImageUrl: img("card"),
	});
	const { refs, leftOut } = collectMedia(post(root));
	assert.deepEqual(refs, [
		{ label: "photo 1", url: img("p1"), altText: "a harbour" },
		{ label: "photo 2", url: img("p2") },
		{ label: "GIF 1", url: img("g1") },
		{ label: "video 1", url: img("v1"), durationS: 12 },
		{ label: "card image", url: img("card") },
	]);
	assert.deepEqual(leftOut, []);
});

test("a URL seen twice is listed once, and the 7th reference is left out and counted", () => {
	const media = Array.from({ length: 7 }, (_, i) => ({ kind: "photo" as const, url: img(`p${i + 1}`) }));
	const root = status("1", { media: [{ kind: "photo", url: img("p1") }, ...media] });
	const { refs, leftOut } = collectMedia(post(root));
	assert.deepEqual(
		refs.map((r) => r.label),
		["photo 1", "photo 2", "photo 3", "photo 4", "photo 5", "photo 6"],
	);
	assert.deepEqual(leftOut, [{ label: "photo 7", url: img("p7"), reason: "over the limit of 6 images" }]);
});

test("a quote's media is labelled quoted, a thread post's thread N", () => {
	const quote = status("2", { media: [{ kind: "photo", url: img("q1") }] });
	const root = status("1", { media: [{ kind: "photo", url: img("r1") }], quote });
	const thread = [status("3"), status("4", { media: [{ kind: "photo", url: img("t1") }] })];
	assert.deepEqual(
		collectMedia(post(root, thread)).refs.map((r) => r.label),
		["photo 1", "quoted photo 1", "thread 2 photo 1"],
	);
});

test("a video without a poster is left out with its reason", () => {
	const { refs, leftOut } = collectMedia(post(status("1", { media: [{ kind: "video", durationS: 3 }] })));
	assert.deepEqual(refs, []);
	assert.deepEqual(leftOut, [{ label: "video 1", durationS: 3, reason: "the video has no poster" }]);
});

// Downloads, against local servers that stand in for the media hosts.

async function serve(t: TestContext, handler: (req: IncomingMessage, res: ServerResponse) => void): Promise<{ port: string; connections: () => number }> {
	let connections = 0;
	const server = createServer(handler);
	server.on("connection", () => connections++);
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	t.after(() => {
		server.closeAllConnections();
		server.close();
	});
	return { port: String((server.address() as AddressInfo).port), connections: () => connections };
}

const lookup = ((hostname: string, options: { all?: boolean }, callback: (...args: unknown[]) => void) => {
	const address = "127.0.0.1";
	if (!hostname.endsWith(".example")) return callback(Object.assign(new Error("ENOTFOUND"), { code: "ENOTFOUND" }));
	return options.all ? callback(null, [{ address, family: isIP(address) }]) : callback(null, address, 4);
}) as Network["lookup"];

const deps: MediaDeps = {
	network: { isAllowedAddress: (ip) => ip === "127.0.0.1", lookup },
	isAllowedHost: (host) => host === "media.example",
	httpsOnly: false,
};

async function failure(promise: Promise<unknown>): Promise<WebError> {
	try {
		await promise;
	} catch (thrown) {
		if (thrown instanceof WebToolError) return thrown.error;
		throw thrown;
	}
	assert.fail("the download succeeded");
}

test("an allowed host returns the bytes and the MIME type", async (t) => {
	const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
	const s = await serve(t, (_req, res) => res.writeHead(200, { "Content-Type": "image/png" }).end(png));
	assert.deepEqual(await downloadImage(`http://media.example:${s.port}/a.png`, deps), { bytes: png, mimeType: "image/png" });
});

test("text/html gives unsupported_media_type", async (t) => {
	const s = await serve(t, (_req, res) => res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end("<html>"));
	assert.deepEqual(await failure(downloadImage(`http://media.example:${s.port}/a.png`, deps)), { kind: "unsupported_media_type", mimeType: "text/html" });
});

test("a body over the image limit gives too_large", async (t) => {
	const s = await serve(t, (_req, res) => res.writeHead(200, { "Content-Type": "image/jpeg" }).end(Buffer.alloc(MAX_IMAGE_BYTES + 1)));
	assert.deepEqual(await failure(downloadImage(`http://media.example:${s.port}/a.jpg`, deps)), { kind: "too_large", limitBytes: MAX_IMAGE_BYTES });
});

test("a redirect to a host outside the allowlist gives media_host_blocked, and that host receives no request", async (t) => {
	const outside = await serve(t, (_req, res) => res.writeHead(200, { "Content-Type": "image/png" }).end("x"));
	const media = await serve(t, (_req, res) => res.writeHead(302, { Location: `http://other.example:${outside.port}/a.png` }).end());
	assert.deepEqual(await failure(downloadImage(`http://media.example:${media.port}/a.png`, deps)), { kind: "media_host_blocked", host: "other.example" });
	assert.equal(outside.connections(), 0);
});

test("with the production rule, an http: media URL is refused before any request", async (t) => {
	const s = await serve(t, (_req, res) => res.end("x"));
	const error = await failure(downloadImage(`http://media.example:${s.port}/a.png`, { ...deps, httpsOnly: true }));
	assert.equal(error.kind, "invalid_url");
	assert.equal(s.connections(), 0);
});

const hosts: [string, boolean][] = [
	["pbs.twimg.com", true],
	["video.twimg.com", true],
	["mosaic.fxtwitter.com", true],
	["evil-twimg.com", false],
	["twimg.com.evil.example", false],
	["pbs.twimg.com.evil.example", false],
	["ton.twimg.com", false],
];

for (const [host, allowed] of hosts) {
	test(`the production allowlist ${allowed ? "accepts" : "refuses"} ${host}`, () => {
		assert.equal(isMediaHost(host), allowed);
	});
}
