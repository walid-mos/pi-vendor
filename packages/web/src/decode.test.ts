import assert from "node:assert/strict";
import { test } from "node:test";

import { decodeText } from "./decode.ts";
import { WebToolError } from "./errors.ts";

// "café" in ISO-8859-1: é is the single byte 0xE9.
const latin1 = Buffer.from([0x63, 0x61, 0x66, 0xe9]);
const utf8 = Buffer.from("café", "utf8");

test("the header's charset is used", () => {
	assert.equal(decodeText(latin1, "text/plain; charset=ISO-8859-1"), "café");
});

test("the header's charset wins over the page's <meta charset>", () => {
	const page = Buffer.concat([Buffer.from('<meta charset="iso-8859-1"><p>'), utf8]);
	assert.equal(decodeText(page, "text/html; charset=utf-8"), '<meta charset="iso-8859-1"><p>café');
});

test("without a header charset, <meta charset> is used", () => {
	const page = Buffer.concat([Buffer.from('<html><head><meta charset="iso-8859-1"></head><p>'), latin1]);
	assert.match(decodeText(page, "text/html"), /<p>café$/);
});

test("without a header charset, <meta http-equiv> is used", () => {
	const page = Buffer.concat([Buffer.from('<meta http-equiv="Content-Type" content="text/html; charset=iso-8859-1"><p>'), latin1]);
	assert.match(decodeText(page, "text/html"), /<p>café$/);
});

test("with neither, the text is read as UTF-8", () => {
	assert.equal(decodeText(utf8, "text/html"), "café");
	assert.equal(decodeText(utf8, ""), "café");
});

test("an unknown charset label gives unsupported_charset", () => {
	assert.throws(
		() => decodeText(utf8, "text/html; charset=klingon-1"),
		(thrown: unknown) => thrown instanceof WebToolError && thrown.error.kind === "unsupported_charset" && thrown.error.charset === "klingon-1",
	);
});
