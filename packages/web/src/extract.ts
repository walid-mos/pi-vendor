/**
 * HTML to markdown, with no network: `article` keeps what Readability finds to be the article, `page` keeps the whole
 * body. Script, style, noscript and template content never reaches the markdown, and links and images are made
 * absolute against the page's URL.
 */

import { isProbablyReaderable, Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import TurndownService from "turndown";

import { WebToolError } from "./errors.ts";

export type Extracted = {
	markdown: string;
	title?: string;
	byline?: string;
	siteName?: string;
	lang?: string;
	publishedTime?: string;
};

const turndown = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced", bulletListMarker: "-" });

export function extract(html: string, baseUrl: string, mode: "article" | "page"): Extracted {
	const document = parse(html);
	const lang = present(document.documentElement.getAttribute("lang"));
	const base = documentBase(document, baseUrl);
	if (mode === "page") return { markdown: toMarkdown(document.body, base), title: present(document.title), lang };

	// Readability returns its best attempt even on a page with no article; Firefox's reader-view test decides instead.
	if (!isProbablyReaderable(document)) throw new WebToolError({ kind: "no_article", url: baseUrl });
	// keepClasses: Readability would drop `language-…`, which names a code block's language.
	const article = new Readability(document, { keepClasses: true }).parse();
	if (!article?.content) throw new WebToolError({ kind: "no_article", url: baseUrl });
	const content = parseHTML(`<html><body>${article.content}</body></html>`).document.body;
	return {
		markdown: toMarkdown(content, base),
		title: present(article.title),
		byline: present(article.byline),
		siteName: present(article.siteName),
		lang: present(article.lang) ?? lang,
		publishedTime: present(article.publishedTime),
	};
}

/**
 * linkedom builds the tree as written, without the <html> and <body> that HTML's rules imply: `document.body` of a page
 * that leaves them out is an empty one it makes up, and an empty input has no root at all. Such a page is parsed again
 * inside a <body>.
 */
function parse(html: string): Document {
	const { document } = parseHTML(html);
	const hasBody = document.documentElement?.tagName === "HTML" && Array.from(document.documentElement.children).some((child) => child.tagName === "BODY");
	return hasBody ? document : parseHTML(`<html><body>${html}</body></html>`).document;
}

/** What the page's relative links are resolved against: its <base href> when it has a usable one, else its own URL. */
function documentBase(document: Document, pageUrl: string): string {
	const href = document.querySelector("base[href]")?.getAttribute("href");
	return href && URL.canParse(href, pageUrl) ? new URL(href, pageUrl).href : pageUrl;
}

function toMarkdown(root: Element, baseUrl: string): string {
	for (const element of root.querySelectorAll("script, style, noscript, template")) element.remove();
	for (const attribute of ["href", "src"]) {
		for (const element of root.querySelectorAll(`[${attribute}]`)) {
			const value = element.getAttribute(attribute) ?? "";
			if (URL.canParse(value, baseUrl)) element.setAttribute(attribute, new URL(value, baseUrl).href);
		}
	}
	return turndown.turndown(root.innerHTML).trim();
}

/** A metadata value, or undefined when the page gives none. */
function present(value: string | null | undefined): string | undefined {
	const trimmed = value?.trim();
	return trimmed ? trimmed : undefined;
}
