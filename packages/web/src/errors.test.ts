import assert from "node:assert/strict";
import { test } from "node:test";

import { describe, type WebError, WebToolError } from "./errors.ts";

test("gateway_missing names the magpie provider and the file to fix", () => {
	const baseUrl = describe({ kind: "gateway_missing", what: "baseUrl" });
	assert.match(baseUrl, /"magpie"/);
	assert.match(baseUrl, /models\.json/);
	const key = describe({ kind: "gateway_missing", what: "key" });
	assert.match(key, /"magpie"/);
	assert.match(key, /auth\.json/);
});

test("gateway_refused carries Magpie's status and message", () => {
	const text = describe({ kind: "gateway_refused", status: 401, message: "the API key sent is not an enabled magpie gateway key" });
	assert.match(text, /401/);
	assert.match(text, /the API key sent is not an enabled magpie gateway key/);
});

test("search_failed carries Magpie's message and says nothing else is tried", () => {
	const text = describe({ kind: "search_failed", message: "SearXNG: connection refused" });
	assert.match(text, /SearXNG: connection refused/);
	assert.match(text, /nothing else is tried/i);
});

test("no_article tells the model to call again with mode: \"page\"", () => {
	assert.match(describe({ kind: "no_article", url: "https://example.com/" }), /mode: "page"/);
});

test("blocked_address names e2e", () => {
	assert.match(describe({ kind: "blocked_address", host: "localhost", address: "127.0.0.1" }), /\be2e\b/);
});

test("x_unavailable names FxTwitter and says nothing else is tried", () => {
	const text = describe({ kind: "x_unavailable", code: 404, reply: { state: "read", text: "NOT_FOUND" } });
	assert.match(text, /FxTwitter/);
	assert.match(text, /nothing else is tried/i);
});

test("no_metadata names e2e", () => {
	assert.match(describe({ kind: "no_metadata", url: "https://www.instagram.com/p/x/", site: "instagram" }), /\be2e\b/);
});

test("pdf_no_text says there is no OCR", () => {
	assert.match(describe({ kind: "pdf_no_text", pages: 3 }), /no OCR/);
});

test("an unknown kind is a bug, not a sentence", () => {
	assert.throws(() => describe({ kind: "nope" } as unknown as WebError), /unknown web error kind "nope"/);
});

test("pdf_no_text does not say '1 pages' for a one-page PDF", () => {
	const text = describe({ kind: "pdf_no_text", pages: 1 });
	assert.doesNotMatch(text, /1 pages/);
	assert.match(text, /no OCR/);
});

test("gateway_missing with a field that is neither baseUrl nor key is a bug, not the key sentence", () => {
	assert.throws(() => describe({ kind: "gateway_missing", what: "nope" } as unknown as WebError), /unknown gateway_missing what "nope"/);
});

const endsWithFullStop: WebError[] = [
	{ kind: "search_failed", message: "SearXNG: connection refused." },
	{ kind: "bad_response", from: "magpie", what: "no result list." },
	{ kind: "invalid_url", url: "ftp://example.com/", reason: "only http and https are read." },
	{ kind: "option_not_supported", option: "replies", reason: "the host does not expose them." },
	{ kind: "pdf_unreadable", reason: "Invalid PDF structure." },
];

for (const error of endsWithFullStop) {
	test(`${error.kind} does not double the full stop that ends a free-text field`, () => {
		assert.doesNotMatch(describe(error), /\.\./);
	});
}

// A server's text reaches the model inside these sentences: a long one is cut, and the cut is stated.
const long = "x".repeat(2000);
const fromServers: WebError[] = [
	{ kind: "gateway_refused", status: 500, message: long },
	{ kind: "search_failed", message: long },
	{ kind: "network", code: "ECONNRESET", message: long },
	{ kind: "x_unavailable", code: 500, reply: { state: "read", text: long } },
	{ kind: "pdf_unreadable", reason: long },
	{ kind: "unsupported_content_type", contentType: long },
	{ kind: "unsupported_charset", charset: long },
	// A redirect's Location is a server's text too: it ends up in these URLs and host names.
	{ kind: "invalid_url", url: long, reason: "not a URL" },
	{ kind: "http_status", status: 404, url: long, body: { state: "read", text: "" } },
	{ kind: "http_status", status: 404, url: "https://example.com/gone", body: { state: "read", text: long } },
	{ kind: "too_many_redirects", limit: 5, chain: [long] },
	{ kind: "dns_failed", host: long, code: "ENOTFOUND" },
	{ kind: "blocked_address", host: long, address: "127.0.0.1" },
	{ kind: "media_host_blocked", host: long },
];

for (const error of fromServers) {
	test(`${error.kind} cuts a server's long text to 500 characters and says so`, () => {
		const text = describe(error);
		assert.ok(text.includes("x".repeat(500)), "keeps the first 500 characters");
		assert.ok(!text.includes("x".repeat(501)), "drops the rest");
		assert.match(text, /1500 more characters/);
	});
}

test("http_status ends at the URL when the server sent no body", () => {
	assert.equal(describe({ kind: "http_status", status: 404, url: "https://example.com/gone", body: { state: "read", text: " \n" } }), "HTTP 404 from https://example.com/gone.");
});

test("http_status gives the server's body after the status", () => {
	assert.equal(
		describe({ kind: "http_status", status: 404, url: "https://example.com/gone", body: { state: "read", text: '{"code":404,"message":"NOT_FOUND"}\n' } }),
		'HTTP 404 from https://example.com/gone: {"code":404,"message":"NOT_FOUND"}',
	);
});

test("a body read only in part keeps its first 500 characters and says the rest was not read", () => {
	const text = describe({ kind: "http_status", status: 502, url: "https://example.com/", body: { state: "cut", text: long } });
	assert.ok(text.includes("x".repeat(500)), "keeps the first 500 characters");
	assert.ok(!text.includes("x".repeat(501)), "drops the rest");
	assert.match(text, /the rest of the body was not read/);
	assert.doesNotMatch(text, /more characters/, "no count: the body's length is unknown");
});

test("a body that could not be read says why", () => {
	const text = describe({ kind: "http_status", status: 404, url: "https://example.com/gone", body: { state: "unreadable", reason: "Network error (ECONNRESET): socket hang up" } });
	assert.equal(text, "HTTP 404 from https://example.com/gone: its body could not be read (Network error (ECONNRESET): socket hang up)");
});

test("x_unavailable gives FxTwitter's reply after its code", () => {
	assert.match(describe({ kind: "x_unavailable", code: 404, reply: { state: "read", text: '{"code":404,"message":"NOT_FOUND"}' } }), /\(404: \{"code":404,"message":"NOT_FOUND"\}\)/);
	assert.match(describe({ kind: "x_unavailable", code: 503, reply: { state: "read", text: "" } }), /\(503\)\. Nothing else is tried\.$/);
});

test("a cut never leaves half of a surrogate pair", () => {
	const text = describe({ kind: "gateway_refused", status: 500, message: `${"x".repeat(499)}😀${"y".repeat(100)}` });
	assert.ok(text.isWellFormed(), "the sentence is well-formed Unicode");
});

test("WebToolError keeps the error it was caught from as its cause", () => {
	const cause = Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" });
	assert.equal(new WebToolError({ kind: "network", code: "ECONNRESET", message: cause.message }, { cause }).cause, cause);
});

test("a server's text made of a long run of dots is read in linear time", () => {
	const start = performance.now();
	describe({ kind: "pdf_unreadable", reason: `${".".repeat(80_000)}x` });
	assert.ok(performance.now() - start < 500, "a quadratic scan of the dots takes seconds");
});

for (const error of [
	{ kind: "no_article", url: `https://example.com/${"a".repeat(2000)}` },
	{ kind: "no_metadata", url: `https://example.com/${"a".repeat(2000)}`, site: "tiktok" },
	{ kind: "unsupported_media_type", mimeType: `image/${"a".repeat(2000)}` },
] as WebError[]) {
	test(`${error.kind} cuts a server's long text too`, () => {
		assert.ok(!describe(error).includes("a".repeat(501)));
	});
}
