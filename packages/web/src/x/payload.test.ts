import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { WebToolError, type WebError } from "../errors.ts";
import { decodePost, type XStatus } from "./payload.ts";

const load = (name: string): Record<string, any> => JSON.parse(readFileSync(new URL(`../fixtures/x/${name}`, import.meta.url), "utf8"));

function failure(run: () => unknown): WebError {
	try {
		run();
	} catch (thrown) {
		if (thrown instanceof WebToolError) return thrown.error;
		throw thrown;
	}
	assert.fail("decodePost succeeded");
}

function status(entry: unknown): XStatus {
	assert.equal((entry as { kind: string }).kind, "status");
	return entry as XStatus;
}

test("the text-only post yields its handle, text, date and engagement", () => {
	const post = decodePost(load("thread-text.json"));
	assert.equal(post.root.id, "20");
	assert.equal(post.root.url, "https://x.com/jack/status/20");
	assert.deepEqual(post.root.author, { handle: "jack", name: "jack" });
	assert.equal(post.root.text, "just setting up my twttr");
	assert.equal(post.root.createdAt, "Tue Mar 21 20:50:14 +0000 2006");
	assert.deepEqual(post.root.engagement, { likes: 325126, reposts: 126274, replies: 19260 });
	assert.deepEqual(post.thread, [], "the thread holds only the root, which is excluded");
	assert.equal(post.replies, undefined);
	assert.deepEqual(post.dropped, { quotes: 0, thread: 0, replies: 0 });
});

test("a count of 0 and a poll choice with 0 votes are kept", () => {
	const json = load("thread-poll.json");
	json.status.likes = 0;
	json.status.poll.choices[1].count = 0;
	const post = decodePost(json);
	assert.equal(post.root.engagement.likes, 0);
	assert.deepEqual(post.root.poll?.choices[1], { label: "No", count: 0 });
});

test("the poll is decoded", () => {
	assert.deepEqual(decodePost(load("thread-poll.json")).root.poll, {
		totalVotes: 17502391,
		choices: [
			{ label: "Yes", count: 10063044 },
			{ label: "No", count: 7439347 },
		],
	});
});

test("the community note and the replied-to handle are decoded", () => {
	assert.equal(decodePost(load("thread-note.json")).root.communityNote, "This was the first post on the service. [Edited for a test.]");
	assert.equal(decodePost(load("thread-reply.json")).root.replyingTo, "SpaceX");
});

test("photos keep their URL; a video keeps its poster and duration", () => {
	const photos = decodePost(load("thread-photos.json")).root.media;
	assert.ok(photos.length > 0);
	assert.ok(photos.every((m) => m.kind === "photo" && m.url.startsWith("https://pbs.twimg.com/media/")));
	const [video] = decodePost(load("thread-video.json")).root.media;
	assert.equal(video.kind, "video");
	assert.equal((video as { durationS?: number }).durationS, 17.25);
	assert.match((video as { posterUrl?: string }).posterUrl ?? "", /^https:\/\/pbs\.twimg\.com\/amplify_video_thumb\/2125262913271132160\//);
});

test("a quote chain 5 deep keeps 3 quotes and counts the 2 dropped", () => {
	const post = decodePost(load("thread-quotes-5.json"));
	const first = status(post.root.quote);
	const second = status(first.quote);
	const third = status(second.quote);
	assert.deepEqual([first.id, second.id, third.id], ["440322224407314432", "9000000000000000001", "9000000000000000002"]);
	assert.equal(third.quote, undefined);
	assert.equal(post.dropped.quotes, 2);
	assert.equal(first.author.handle, "TheEllenShow");
});

test("a quote that FxTwitter cannot show is kept as unavailable, with its reason", () => {
	const json = load("thread-text.json");
	json.status.quote = { type: "tombstone", reason: "deleted", message: "This post was deleted", id: "1", url: "https://x.com/i/status/1" };
	assert.deepEqual(decodePost(json).root.quote, { kind: "unavailable", reason: "deleted", url: "https://x.com/i/status/1" });
});

test("a thread of 12 keeps 10, the root excluded, and counts the one dropped", () => {
	const post = decodePost(load("thread-12.json"));
	assert.equal(post.thread.length, 10);
	assert.ok(post.thread.every((entry) => status(entry).id !== "20"));
	assert.equal(status(post.thread[0]).text, "Thread post 2");
	assert.equal(post.dropped.thread, 1);
});

test("replies leave out the author's thread and keep at most 20", () => {
	const post = decodePost(load("thread-photos.json"), load("conversation-photos.json"));
	const threadIds = new Set(post.thread.map((entry) => status(entry).id));
	assert.deepEqual([...threadIds], ["2124467677859332290"]);
	assert.equal(post.replies?.length, 20);
	assert.ok(post.replies?.every((entry) => !threadIds.has(status(entry).id) && status(entry).id !== post.root.id));
	assert.equal(post.dropped.replies, 6, "27 replies, 1 of them in the thread, 20 kept");
});

test("a quoted, threaded or replied post's text is cut at 4000 characters, and the cut is stated", () => {
	const json = load("thread-quotes-5.json");
	json.status.quote.text = "q".repeat(5000);
	json.status.text = "r".repeat(5000);
	const post = decodePost(json);
	assert.equal(post.root.text, "r".repeat(5000), "the root's own text is not cut");
	assert.equal(status(post.root.quote).text, `${"q".repeat(4000)}… (1000 more characters)`);
});

test("a status with no text gives bad_response from fxtwitter", () => {
	const json = load("thread-text.json");
	delete json.status.text;
	assert.deepEqual(failure(() => decodePost(json)), { kind: "bad_response", from: "fxtwitter", what: "status.text is not a string" });
});

test("the not-found reply gives x_unavailable with its code", () => {
	assert.deepEqual(failure(() => decodePost(load("not-found.json"))), { kind: "x_unavailable", code: 404, message: "not found" });
});

test("FxTwitter's own error message is kept", () => {
	assert.deepEqual(failure(() => decodePost(load("bad-id.json"))), { kind: "x_unavailable", code: 400, message: "id: tweet ID must be a numeric snowflake" });
});

test("a reply that is not an object gives bad_response", () => {
	assert.deepEqual(failure(() => decodePost("<html>")), { kind: "bad_response", from: "fxtwitter", what: "the reply is not an object" });
});
