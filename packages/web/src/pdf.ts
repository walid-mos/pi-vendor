/**
 * PDF bytes to text with unpdf's bundled pdf.js, in Pi's own process: text only (no rendering, fonts, images or OCR),
 * page by page, so the page limit, the caller's abort and the deadline are checked between pages. A page being parsed
 * cannot be interrupted. vendor.json holds the review of the bundled pdf.js.
 */

import { getResolvedPDFJS } from "unpdf";
import type { PDFDocumentProxy } from "unpdf/pdfjs";

import { WebToolError } from "./errors.ts";

/** A long report stays readable; beyond this, the text says which pages it holds. */
export const MAX_PDF_PAGES = 200;

/** Parsing a large file page by page; the deadline is checked before each page, so a page being parsed can run past it. */
export const PDF_TIMEOUT_MS = 30_000;

export type PdfOptions = {
	maxPages: number;
	timeoutMs: number;
	signal?: AbortSignal;
	/** Called after each page is read, with its number. */
	onPage?: (page: number) => void;
};

export type PdfText = { text: string; title?: string; author?: string; pagesTotal: number; pagesExtracted: number };

export async function extractPdf(bytes: Uint8Array, options: PdfOptions): Promise<PdfText> {
	const deadline = Date.now() + options.timeoutMs;
	// pdf.js transfers away the buffer it is given; a copy leaves the caller's bytes intact.
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
		// Only the pages read are known to hold no text: the ones beyond the limit were never looked at.
		if (pages.every((page) => page === "")) throw new WebToolError({ kind: "pdf_no_text", pages: pagesExtracted });
		const { info } = (await pdf.getMetadata()) as { info: { Title?: unknown; Author?: unknown } };
		const blank = pages.flatMap((page, index) => (page === "" ? [index + 1] : []));
		const notes = [
			pagesExtracted < pagesTotal ? `Pages 1 to ${pagesExtracted} of ${pagesTotal}.` : undefined,
			blank.length > 0 ? `No text on ${blank.length === 1 ? "page" : "pages"} ${blank.join(", ")}.` : undefined,
		].filter(Boolean);
		const body = pages.filter((page) => page !== "").join("\n\n");
		return {
			text: notes.length > 0 ? `${notes.join(" ")}\n\n${body}` : body,
			title: oneLine(info.Title),
			author: oneLine(info.Author),
			pagesTotal,
			pagesExtracted,
		};
	} finally {
		await pdf.loadingTask.destroy();
	}
}

async function open(data: Uint8Array): Promise<PDFDocumentProxy> {
	const { getDocument } = await getResolvedPDFJS();
	// Verbosity 0: errors only. unpdf's getDocumentProxy is not used: when it fails it hands back no task, and pdf.js
	// keeps the file's bytes until its task is destroyed.
	const task = getDocument({ data, verbosity: 0 });
	try {
		return await task.promise;
	} catch (thrown) {
		await task.destroy();
		throw unreadable(thrown);
	}
}

async function pageText(pdf: PDFDocumentProxy, n: number): Promise<string> {
	try {
		const page = await pdf.getPage(n);
		const content = await page.getTextContent();
		let text = "";
		for (const item of content.items) {
			if (!("str" in item)) continue;
			text += item.str + (item.hasEOL ? "\n" : "");
		}
		return text.trim();
	} catch (thrown) {
		throw unreadable(thrown, `page ${n}: `);
	}
}

/** The file is untrusted input: whatever pdf.js fails on while reading it, the file cannot be read. */
function unreadable(thrown: unknown, where = ""): WebToolError {
	const reason = (thrown as Error).name === "PasswordException" ? "it is encrypted with a password" : where + String((thrown as Error).message ?? thrown);
	return new WebToolError({ kind: "pdf_unreadable", reason }, { cause: thrown });
}

/** A metadata field is one line of a header: its line breaks and runs of spaces collapse. */
function oneLine(value: unknown): string | undefined {
	const text = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
	return text || undefined;
}
