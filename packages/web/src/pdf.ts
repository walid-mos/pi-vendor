/**
 * PDF bytes to text with unpdf's bundled pdf.js, in Pi's own process: text only (no rendering, fonts, images or OCR),
 * page by page, so the page limit, the caller's abort and the deadline are checked between pages. A page being parsed
 * cannot be interrupted. The bundled pdf.js holds no eval and no Function constructor (reviewed in vendor.json).
 */

import { getDocumentProxy } from "unpdf";

import { WebToolError } from "./errors.ts";

/** A long report stays readable; beyond this, the text says which pages it holds. */
export const MAX_PDF_PAGES = 200;

/** Parsing a large file page by page; the whole extraction must end within this. */
export const PDF_TIMEOUT_MS = 30_000;

export type PdfOptions = {
	maxPages: number;
	timeoutMs: number;
	signal?: AbortSignal;
	/** Called after each page is read, with its number. */
	onPage?: (page: number) => void;
};

export type PdfText = { text: string; title?: string; author?: string; pagesTotal: number; pagesExtracted: number };

type Document = Awaited<ReturnType<typeof getDocumentProxy>>;

export async function extractPdf(bytes: Uint8Array, options: PdfOptions): Promise<PdfText> {
	const deadline = Date.now() + options.timeoutMs;
	// pdf.js takes the buffer it is given; a copy leaves the caller's bytes intact. Verbosity 0: errors only.
	const pdf = await open(new Uint8Array(bytes));
	try {
		const pagesTotal = pdf.numPages;
		const pagesExtracted = Math.min(pagesTotal, options.maxPages);
		const pages: string[] = [];
		for (let n = 1; n <= pagesExtracted; n++) {
			if (options.signal?.aborted) throw new WebToolError({ kind: "aborted" });
			if (Date.now() >= deadline) throw new WebToolError({ kind: "timeout", afterMs: options.timeoutMs });
			pages.push(await pageText(pdf, n));
			options.onPage?.(n);
		}
		if (pages.every((page) => page === "")) throw new WebToolError({ kind: "pdf_no_text", pages: pagesTotal });
		const { info } = (await pdf.getMetadata()) as { info: { Title?: unknown; Author?: unknown } };
		const body = pages.filter((page) => page !== "").join("\n\n");
		return {
			text: pagesExtracted < pagesTotal ? `Pages 1 to ${pagesExtracted} of ${pagesTotal}.\n\n${body}` : body,
			title: nonEmpty(info.Title),
			author: nonEmpty(info.Author),
			pagesTotal,
			pagesExtracted,
		};
	} finally {
		await pdf.loadingTask.destroy();
	}
}

async function open(data: Uint8Array): Promise<Document> {
	try {
		return await getDocumentProxy(data, { verbosity: 0 });
	} catch (thrown) {
		// The file is untrusted input: whatever pdf.js fails on while opening it, the file cannot be read.
		const reason = (thrown as Error).name === "PasswordException" ? "it is encrypted with a password" : String((thrown as Error).message ?? thrown);
		throw new WebToolError({ kind: "pdf_unreadable", reason }, { cause: thrown });
	}
}

async function pageText(pdf: Document, n: number): Promise<string> {
	const page = await pdf.getPage(n);
	const content = await page.getTextContent();
	let text = "";
	for (const item of content.items) {
		if (!("str" in item)) continue;
		text += item.str + (item.hasEOL ? "\n" : "");
	}
	return text.trim();
}

function nonEmpty(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
