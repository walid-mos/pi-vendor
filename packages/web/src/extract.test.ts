import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { WebToolError, type WebError } from "./errors.ts";
import { extract } from "./extract.ts";

const fixture = (name: string) => readFileSync(new URL(`fixtures/${name}`, import.meta.url), "utf8");
const BASE = "https://coastal.example.com/2026/03/tides";

function failure(run: () => unknown): WebError {
	try {
		run();
	} catch (thrown) {
		if (thrown instanceof WebToolError) return thrown.error;
		throw thrown;
	}
	assert.fail("extract succeeded");
}

test("the article yields its heading and paragraphs", () => {
	const { markdown } = extract(fixture("article.html"), BASE, "article");
	assert.match(markdown, /^## Reading a tide table$/m);
	assert.match(markdown, /The North Sea has two high tides a day/);
	assert.match(markdown, /to navigate by\./);
});

test("the article leaves out the nav, footer, script and style text", () => {
	const { markdown } = extract(fixture("article.html"), BASE, "article");
	for (const marker of ["NAV-TEXT-MARKER", "FOOTER-TEXT-MARKER", "SCRIPT-TEXT-MARKER", "STYLE-TEXT-MARKER"]) {
		assert.doesNotMatch(markdown, new RegExp(marker));
	}
});

test("relative links become absolute against the base URL", () => {
	const { markdown } = extract(fixture("article.html"), BASE, "article");
	assert.match(markdown, /\[guide to\s+tide tables\]\(https:\/\/coastal\.example\.com\/guides\/tide-tables\)/);
	assert.match(markdown, /\[live readings\]\(https:\/\/tides\.example\.org\/today\)/);
});

test("code blocks are fenced", () => {
	const { markdown } = extract(fixture("article.html"), BASE, "article");
	assert.match(markdown, /```python\ndef height\(hours_after_low\):\n {4}return 1\.2 \+ 2\.4 \* hours_after_low \/ 6\n```/);
});

test("title, byline, site name, language and date are returned", () => {
	const { title, byline, siteName, lang, publishedTime } = extract(fixture("article.html"), BASE, "article");
	assert.deepEqual(
		{ title, byline, siteName, lang, publishedTime },
		{
			title: "Tides of the North Sea",
			byline: "Ada Marlow",
			siteName: "The Coastal Review",
			lang: "en-GB",
			publishedTime: "2026-03-14T09:30:00Z",
		},
	);
});

test("a page with no article gives no_article in article mode", () => {
	assert.deepEqual(failure(() => extract(fixture("no-article.html"), BASE, "article")), { kind: "no_article", url: BASE });
});

test("page mode returns the body's text without script or style content", () => {
	const { markdown, title, lang } = extract(fixture("no-article.html"), BASE, "page");
	assert.match(markdown, /Sign in to continue\./);
	assert.match(markdown, /\[Home\]\(https:\/\/coastal\.example\.com\/\)/);
	assert.doesNotMatch(markdown, /SCRIPT_MARKER|p\{\}/);
	assert.equal(title, "Sign in");
	assert.equal(lang, "fr");
});

test("page mode keeps the nav and footer that article mode leaves out", () => {
	const { markdown } = extract(fixture("article.html"), BASE, "page");
	assert.match(markdown, /NAV-TEXT-MARKER/);
	assert.match(markdown, /FOOTER-TEXT-MARKER/);
	assert.doesNotMatch(markdown, /SCRIPT-TEXT-MARKER|STYLE-TEXT-MARKER/);
});

test("an empty page gives empty markdown", () => {
	assert.equal(extract("", BASE, "page").markdown, "");
});

test("a page that leaves out <html>, <head> and <body> keeps its content", () => {
	const { markdown } = extract("<!doctype html><title>Bare</title><p>Bare page text.</p>", BASE, "page");
	assert.match(markdown, /Bare page text\./);
});

test("a page with <html> and <head> but no <body> keeps its title and language, and the title is not read as text", () => {
	const html = '<!doctype html><html lang="fr"><head><title>Le titre</title></head><p>Bonjour tout le monde.</p></html>';
	assert.deepEqual(extract(html, BASE, "page"), { markdown: "Bonjour tout le monde.", title: "Le titre", lang: "fr" });
});

test("links are resolved against the page's <base href>", () => {
	const html = fixture("article.html")
		.replace("<head>", '<head><base href="/assets/">')
		.replace('href="/guides/tide-tables"', 'href="guides/tide-tables"');
	for (const mode of ["article", "page"] as const) {
		const { markdown } = extract(html, BASE, mode);
		assert.match(markdown, /\]\(https:\/\/coastal\.example\.com\/assets\/guides\/tide-tables\)/, mode);
	}
});
