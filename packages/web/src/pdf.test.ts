import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { WebToolError, type WebError } from "./errors.ts";
import { extractPdf, type PdfOptions } from "./pdf.ts";

const fixture = (name: string) => readFileSync(new URL(`fixtures/${name}`, import.meta.url));
const options = (more: Partial<PdfOptions> = {}): PdfOptions => ({ maxPages: 200, timeoutMs: 30_000, ...more });

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
	const bytes = fixture("two-pages.pdf");
	const copy = Buffer.from(bytes);
	await extractPdf(bytes, options());
	assert.deepEqual(bytes, copy);
});
