import assert from "node:assert/strict";
import { test } from "node:test";

import { describe, type WebError } from "./errors.ts";

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
	const text = describe({ kind: "x_unavailable", code: 404, message: "NOT_FOUND" });
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
