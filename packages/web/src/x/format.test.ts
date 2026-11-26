import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { formatPost, type MediaLine } from "./format.ts";
import { decodePost } from "./payload.ts";

const load = (name: string): Record<string, any> => JSON.parse(readFileSync(new URL(`../fixtures/x/${name}`, import.meta.url), "utf8"));

test("the text-only post is formatted as written by hand", () => {
	assert.equal(
		formatPost(decodePost(load("thread-text.json")), []),
		["@jack, Tue Mar 21 20:50:14 +0000 2006", "https://x.com/jack/status/20", "", "just setting up my twttr", "", "325126 likes, 126274 reposts, 19260 replies"].join("\n"),
	);
});

test("a count of 0 is shown", () => {
	const json = load("thread-text.json");
	json.status.likes = 0;
	assert.match(formatPost(decodePost(json), []), /^0 likes, 126274 reposts, 19260 replies$/m);
});

test("the poll, the community note and the replied-to handle are shown", () => {
	const poll = formatPost(decodePost(load("thread-poll.json")), []);
	assert.match(poll, /^Poll, 17502391 votes:\n- Yes: 10063044\n- No: 7439347$/m);
	assert.match(formatPost(decodePost(load("thread-note.json")), []), /^Community note: This was the first post on the service\. \[Edited for a test\.\]$/m);
	assert.match(formatPost(decodePost(load("thread-reply.json")), []), /^Replying to @SpaceX$/m);
});

test("quotes are nested, one level of > per quote", () => {
	const text = formatPost(decodePost(load("thread-quotes-5.json")), []);
	assert.match(text, /^Quoting:\n> @TheEllenShow \(The Ellen Show\), /m);
	assert.match(text, /^> > @BarackObama \(Barack Obama\), /m);
	assert.match(text, /^> > > @TheEllenShow \(The Ellen Show\), /m);
	assert.doesNotMatch(text, /^> > > > @/m);
});

test("what the caps left out is stated in a last line", () => {
	const quotes = formatPost(decodePost(load("thread-quotes-5.json")), []);
	assert.match(quotes, /\nLeft out by the limits: 2 deeper quotes\.$/);
	const replies = formatPost(decodePost(load("thread-12.json"), load("conversation-photos.json")), []);
	assert.match(replies, /\nLeft out by the limits: 1 thread post, 7 replies\.$/);
});

test("the thread and the replies follow the post, each with its author", () => {
	const text = formatPost(decodePost(load("thread-photos.json"), load("conversation-photos.json")), []);
	assert.match(text, /^Thread by @SpaceX, 1 more post:\n\n@SpaceX, /m);
	assert.match(text, /^Replies, 20 shown:\n\n@/m);
});

test("an unavailable quote says why", () => {
	const json = load("thread-text.json");
	json.status.quote = { type: "tombstone", reason: "deleted", id: "1", url: "https://x.com/i/status/1" };
	assert.match(formatPost(decodePost(json), []), /^Quoting:\n> An unavailable post \(deleted\): https:\/\/x\.com\/i\/status\/1$/m);
});

test("the media list has one line per item: its label, a video's duration, alt text, and what was not attached", () => {
	const media: MediaLine[] = [
		{ label: "photo 1", altText: "A crowd at the Oscars", outcome: { state: "attached" } },
		{ label: "photo 2", outcome: { state: "failed", error: { kind: "http_status", status: 404, url: "https://pbs.twimg.com/media/b.jpg" } } },
		{ label: "video 1", durationS: 17.25, outcome: { state: "attached" } },
		{ label: "photo 7", outcome: { state: "left_out", reason: "over the limit of 6 images" } },
	];
	const text = formatPost(decodePost(load("thread-text.json")), media);
	assert.ok(
		text.endsWith(
			[
				"Media:",
				"- photo 1: A crowd at the Oscars",
				"- photo 2: not attached (HTTP 404 from https://pbs.twimg.com/media/b.jpg.)",
				"- video 1 (a 17.25 s video; the image is its poster)",
				"- photo 7: not attached (over the limit of 6 images)",
			].join("\n"),
		),
		text,
	);
});
