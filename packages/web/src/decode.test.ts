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

test("a byte order mark wins over the header's charset", () => {
	const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("<p>café</p>", "utf16le")]);
	assert.equal(decodeText(utf16, "text/html; charset=utf-8"), "<p>café</p>");
	const bom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), utf8]);
	assert.equal(decodeText(bom, "text/plain; charset=iso-8859-1"), "café");
});

test("a <meta> tag cut off by the end of the prescan window is not read", () => {
	// The tag starts at byte 1000 and its label 15 bytes later: the 1024-byte window ends 9 bytes into the label.
	const page = Buffer.from(`<html>${" ".repeat(994)}<meta charset="windows-1252"><p>café`);
	assert.equal(decodeText(page, "text/html"), page.toString("utf8"));
});

test("a charset named inside another attribute's value is not a declaration", () => {
	const page = Buffer.from('<meta name="description" content="Declare it with charset=iso-8859-1 in the head"><meta name="x" data-charset="iso-8859-1"><p>café');
	assert.equal(decodeText(page, "text/html"), page.toString("utf8"));
});

test("a commented-out <meta> is not read", () => {
	const page = Buffer.from('<!-- <meta charset="iso-8859-1"> --><meta charset="utf-8"><p>café');
	assert.equal(decodeText(page, "text/html"), page.toString("utf8"));
});
