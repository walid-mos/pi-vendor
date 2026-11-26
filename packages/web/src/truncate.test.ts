import assert from "node:assert/strict";
import { readFileSync, rmSync, statSync } from "node:fs";
import { dirname } from "node:path";
import { test } from "node:test";

import { capText } from "./truncate.ts";

const limits = { maxBytes: 1000, maxLines: 10 };

function cleanUp(path: string | undefined): void {
	if (path) rmSync(dirname(path), { recursive: true });
}

test("text under the limits is returned unchanged, with no file", async () => {
	const text = "one\ntwo\nthree";
	assert.deepEqual(await capText(text, limits), { text, truncated: false });
});

test("text over the line limit is cut at a line boundary and ends with the path of the full text", async () => {
	const lines = Array.from({ length: 25 }, (_, i) => `line ${i + 1}`);
	const full = lines.join("\n");
	const capped = await capText(full, limits);
	try {
		assert.equal(capped.truncated, true);
		assert.ok(capped.fullOutputPath);
		assert.ok(capped.text.startsWith(`${lines.slice(0, 10).join("\n")}\n`));
		assert.doesNotMatch(capped.text, /^line 11$/m);
		assert.ok(capped.text.trimEnd().endsWith(capped.fullOutputPath), "the text ends with the path");
		assert.match(capped.text, /lines 1 to 10 of 25/);
		assert.equal(readFileSync(capped.fullOutputPath, "utf8"), full);
		assert.equal(statSync(capped.fullOutputPath).mode & 0o777, 0o600);
	} finally {
		cleanUp(capped.fullOutputPath);
	}
});

test("text over the byte limit keeps whole lines within it", async () => {
	const line = "é".repeat(99); // 198 bytes, 199 with its newline
	const full = Array.from({ length: 8 }, () => line).join("\n");
	const capped = await capText(full, limits);
	try {
		assert.equal(capped.truncated, true);
		const kept = capped.text.slice(0, capped.text.indexOf("\n\n["));
		assert.equal(kept.split("\n").length, 5, "5 lines fit in 1000 bytes (993 with their newlines); the note comes after");
		assert.ok(kept.split("\n").every((l) => l === line), "no line is cut");
		assert.equal(readFileSync(capped.fullOutputPath!, "utf8"), full);
	} finally {
		cleanUp(capped.fullOutputPath);
	}
});

test("a single line longer than the byte limit is cut inside the line, on a character boundary", async () => {
	const full = "é".repeat(2000);
	const capped = await capText(full, limits);
	try {
		const kept = capped.text.slice(0, capped.text.indexOf("\n\n["));
		assert.ok(kept.length > 0 && /^é+$/.test(kept));
		assert.ok(Buffer.byteLength(capped.text) <= limits.maxBytes + 200, "the note adds only its own short text");
	} finally {
		cleanUp(capped.fullOutputPath);
	}
});
