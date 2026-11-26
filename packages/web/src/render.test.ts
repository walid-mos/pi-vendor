import assert from "node:assert/strict";
import { test } from "node:test";

import { renderFetchCall, renderFetchResult, renderSearchCall, renderSearchResult, type Theme } from "./render.ts";

/** Tags text with its role; a role outside the renderer's list fails the test, not Pi at run time. */
const theme: Theme = {
	fg(role, text) {
		assert.ok(["toolTitle", "accent", "muted", "toolOutput", "error"].includes(role), `role ${role} is not one of the visual grammar's`);
		return `<${role}>${text}</${role}>`;
	},
	bold: (text) => `**${text}**`,
};

const searchText = "1. Rule of twelfths - Wikipedia — https://en.wikipedia.org/wiki/Rule_of_twelfths\nAn approximation.\n\n2. Tides — https://tides.example.org/\nMore.";

test("the search call shows the tool, the query and the options", () => {
	assert.equal(renderSearchCall({ query: "tides", count: 5, freshness: "week" }, theme), "<toolTitle>**Web search**</toolTitle> <accent>tides</accent> <muted>5 results, past week</muted>");
});

test("a collapsed search result is a single line holding the first result's line", () => {
	const line = renderSearchResult({ content: [{ type: "text", text: searchText }], details: { ok: true, query: "tides", bytes: 100, truncated: false } }, false, theme);
	assert.equal(line, "<muted>1. Rule of twelfths - Wikipedia — https://en.wikipedia.org/wiki/Rule_of_twelfths</muted>");
});

test("an expanded search result shows Magpie's whole text", () => {
	const text = renderSearchResult({ content: [{ type: "text", text: searchText }], details: { ok: true, query: "tides", bytes: 100, truncated: false } }, true, theme);
	assert.match(text, /https:\/\/en\.wikipedia\.org\/wiki\/Rule_of_twelfths/);
	assert.match(text, /https:\/\/tides\.example\.org\//);
	assert.match(text, /^<toolOutput>/);
});

test("a failure uses the error role and the describe text", () => {
	const failed = { content: [{ type: "text" as const, text: "ignored" }], details: { ok: false as const, error: { kind: "search_failed" as const, message: "SearXNG: connection refused" } } };
	assert.equal(renderSearchResult(failed, false, theme), "<error>Magpie's web search failed: SearXNG: connection refused. Nothing else is tried.</error>");
	assert.equal(renderFetchResult(failed, true, theme), "<error>Magpie's web search failed: SearXNG: connection refused. Nothing else is tried.</error>");
});

test("the fetch call shows the URL and the options", () => {
	assert.equal(renderFetchCall({ url: "https://x.com/jack/status/20", replies: true }, theme), "<toolTitle>**Fetch content**</toolTitle> <accent>https://x.com/jack/status/20</accent> <muted>with replies</muted>");
	assert.equal(renderFetchCall({ url: "https://example.com/", mode: "page" }, theme), "<toolTitle>**Fetch content**</toolTitle> <accent>https://example.com/</accent> <muted>whole page</muted>");
});

const page = { url: "https://example.com/a", finalUrl: "https://example.com/a", redirects: [], status: 200 };

test("a collapsed page result shows its title and size", () => {
	const line = renderFetchResult({ content: [], details: { ok: true, kind: "article", ...page, contentType: "text/html", title: "Tides", bytes: 12_600, truncated: false } }, false, theme);
	assert.equal(line, "<muted>Tides · 12.3 KB</muted>");
});

test("a PDF the page limit cut shows pages 1 to 200 of 731", () => {
	const line = renderFetchResult({ content: [], details: { ok: true, kind: "pdf", ...page, title: "Report", pagesTotal: 731, pagesExtracted: 200, bytes: 2_000_000, truncated: false } }, false, theme);
	assert.equal(line, "<muted>Report · pages 1 to 200 of 731</muted>");
});

test("an X post with one failed image shows the failed count in the error role", () => {
	const details = {
		ok: true as const,
		kind: "x_status" as const,
		url: "https://x.com/jack/status/20",
		id: "20",
		author: "jack",
		media: [
			{ label: "photo 1", state: "attached" as const },
			{ label: "photo 2", state: "failed" as const, error: { kind: "image_undecodable" as const } },
		],
		quotes: 0,
		thread: 0,
		dropped: { quotes: 0, thread: 0, replies: 0 },
		truncated: false,
	};
	assert.equal(renderFetchResult({ content: [], details }, false, theme), "<muted>@jack · 1 image</muted> <error>1 not attached</error>");
});

test("social metadata shows the site and says it is metadata only", () => {
	const details = { ok: true as const, kind: "social_meta" as const, url: "https://www.instagram.com/nasa/", finalUrl: "https://www.instagram.com/nasa/", meta: { site: "instagram" as const, title: "NASA" } };
	assert.equal(renderFetchResult({ content: [], details }, false, theme), "<muted>instagram · NASA · metadata only</muted>");
});

test("an expanded fetch result shows the first lines of the text", () => {
	const text = Array.from({ length: 40 }, (_, i) => `line ${i + 1}`).join("\n");
	const out = renderFetchResult({ content: [{ type: "text", text }], details: { ok: true, kind: "text", ...page, contentType: "text/plain", bytes: 300, truncated: false } }, true, theme);
	assert.match(out, /line 1\n/);
	assert.match(out, /line 20/);
	assert.doesNotMatch(out, /line 21\b/);
	assert.match(out, /<muted>… 20 more lines<\/muted>$/);
});

test("before the result exists, a pending line is shown", () => {
	assert.equal(renderFetchResult({ content: [], details: undefined }, false, theme), "<muted>…</muted>");
});
