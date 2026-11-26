import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { setFlagsFromString } from "node:v8";
import { runInNewContext } from "node:vm";

import { describe, WebToolError, type WebError } from "./errors.ts";
import { extractPdf, type PdfOptions } from "./pdf.ts";

const fixture = (name: string) => readFileSync(new URL(`fixtures/${name}`, import.meta.url));
const options = (more: Partial<PdfOptions> = {}): PdfOptions => ({ maxPages: 200, timeoutMs: 30_000, ...more });

/** A fixture with one string of its bytes replaced; `to` is as long as `from`, so the file's offsets stay valid. */
function edited(name: string, from: string, to: string): Buffer {
	const text = fixture(name).toString("latin1");
	assert.ok(text.includes(from), `${name} holds no ${from}`);
	assert.equal(to.length, from.length);
	return Buffer.from(text.replace(from, to), "latin1");
}

setFlagsFromString("--expose-gc");
const collectGarbage = runInNewContext("gc") as () => void;

async function failure(promise: Promise<unknown>): Promise<WebError> {
	try {
		await promise;
	} catch (thrown) {
		if (thrown instanceof WebToolError) return thrown.error;
		throw thrown;
	}
	assert.fail("the extraction succeeded");
}

test("the two-page fixture yields both sentences in page order, and its title and author", async () => {
	const pdf = await extractPdf(fixture("two-pages.pdf"), options());
	const first = pdf.text.indexOf("The first page says the harbour opens at dawn.");
	const second = pdf.text.indexOf("The second page says the ferry leaves at noon.");
	assert.ok(first >= 0 && second > first, pdf.text);
	assert.equal(pdf.title, "Harbour Notes");
	assert.equal(pdf.author, "Ada Marlow");
	assert.deepEqual([pdf.pagesTotal, pdf.pagesExtracted], [2, 2]);
	assert.doesNotMatch(pdf.text, /^Pages 1 to/);
});

test("with a page limit of 2, the three-page fixture yields pages 1 and 2 and says so", async () => {
	const pdf = await extractPdf(fixture("three-pages.pdf"), options({ maxPages: 2 }));
	assert.match(pdf.text, /Page one of three: sand\./);
	assert.match(pdf.text, /Page two of three: shingle\./);
	assert.doesNotMatch(pdf.text, /rock/);
	assert.deepEqual([pdf.pagesTotal, pdf.pagesExtracted], [3, 2]);
	assert.match(pdf.text, /^Pages 1 to 2 of 3/);
});

test("the encrypted fixture gives pdf_unreadable", async () => {
	const error = await failure(extractPdf(fixture("encrypted.pdf"), options()));
	assert.deepEqual(error, { kind: "pdf_unreadable", reason: "it is encrypted with a password" });
});

test("bytes that are not a PDF give pdf_unreadable", async () => {
	const error = await failure(extractPdf(Buffer.from("<html>not a pdf</html>"), options()));
	assert.equal(error.kind, "pdf_unreadable");
});

test("the image-only fixture gives pdf_no_text with its page count", async () => {
	assert.deepEqual(await failure(extractPdf(fixture("image-only.pdf"), options())), { kind: "pdf_no_text", pages: 2 });
});

test("a signal aborted after the first page gives aborted, and page 2 is not read", async () => {
	const controller = new AbortController();
	const read: number[] = [];
	const onPage = (page: number) => {
		read.push(page);
		controller.abort();
	};
	assert.deepEqual(await failure(extractPdf(fixture("three-pages.pdf"), options({ signal: controller.signal, onPage }))), { kind: "aborted" });
	assert.deepEqual(read, [1]);
});

test("a deadline of 0 gives timeout", async () => {
	assert.deepEqual(await failure(extractPdf(fixture("two-pages.pdf"), options({ timeoutMs: 0 }))), { kind: "timeout", afterMs: 0 });
});

test("the caller's bytes are left intact", async () => {
	// A buffer that fills its own ArrayBuffer, as a downloaded body does: pdf.js transfers such a buffer away.
	const bytes = Buffer.from(new Uint8Array(fixture("two-pages.pdf")).buffer);
	const copy = Buffer.from(bytes);
	await extractPdf(bytes, options());
	assert.deepEqual(bytes, copy);
});

test("with a page limit of 1, the image-only fixture says that 1 page holds no text, not 2", async () => {
	assert.deepEqual(await failure(extractPdf(fixture("image-only.pdf"), options({ maxPages: 1 }))), { kind: "pdf_no_text", pages: 1 });
});

test("a page whose tree entry is damaged gives pdf_unreadable, naming the page", async () => {
	const damaged = edited("three-pages.pdf", "/Kids [ 1 0 R 8 0 R", "/Kids [ 1 0 R 7 0 R");
	const error = await failure(extractPdf(damaged, options()));
	assert.equal(error.kind, "pdf_unreadable");
	assert.match(describe(error), /^The PDF cannot be read: page 2: /);
});

test("a page without text is named in the text, and so is a page limit", async () => {
	const blankFirstPage = edited("three-pages.pdf", "/Contents 3 0 R", "/Contentz 3 0 R");
	const all = await extractPdf(blankFirstPage, options());
	assert.match(all.text, /^No text on page 1\.\n\nPage two of three: shingle\.\n\nPage three of three: rock\.$/);
	const limited = await extractPdf(blankFirstPage, options({ maxPages: 2 }));
	assert.match(limited.text, /^Pages 1 to 2 of 3\. No text on page 1\.\n\nPage two of three: shingle\.$/);
});

test("a title with a line break is one line", async () => {
	const pdf = await extractPdf(edited("two-pages.pdf", "Harbour Notes", "Harbour\nNotes"), options());
	assert.equal(pdf.title, "Harbour Notes");
});

test("a file that cannot be opened is not kept in memory", async () => {
	const file = Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(1_000_000, 0x20)]);
	const held = async () => {
		await new Promise((resolve) => setTimeout(resolve, 20));
		collectGarbage();
		collectGarbage();
		return process.memoryUsage().arrayBuffers;
	};
	await failure(extractPdf(file, options())); // the first call loads pdf.js
	const before = await held();
	for (let i = 0; i < 20; i++) await failure(extractPdf(file, options()));
	const retained = (await held()) - before;
	assert.ok(retained < 5_000_000, `${retained} bytes of unreadable files are still held`);
});
