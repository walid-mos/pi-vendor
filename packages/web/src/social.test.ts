import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { WebToolError, type WebError } from "./errors.ts";
import { socialMeta } from "./social.ts";

const fixture = (name: string) => readFileSync(new URL(`fixtures/${name}`, import.meta.url), "utf8");

function failure(run: () => unknown): WebError {
	try {
		run();
	} catch (thrown) {
		if (thrown instanceof WebToolError) return thrown.error;
		throw thrown;
	}
	assert.fail("socialMeta succeeded");
}

test("an Instagram profile yields its og: title, description and image, entities decoded", () => {
	assert.deepEqual(socialMeta(fixture("instagram-profile.html"), "https://www.instagram.com/nasa/", "instagram"), {
		site: "instagram",
		title: "NASA (@nasa) • Instagram photos and videos",
		description: "104M Followers, 95 Following, 5,027 Posts - See Instagram photos and videos from NASA (@nasa)",
		imageUrl: "https://scontent-cdg6-1.cdninstagram.com/v/t51.2885-19/29090066_159271188110124_1152068159029641216_n.jpg",
	});
});

test("a Threads profile yields its og: title and description", () => {
	const meta = socialMeta(fixture("threads-profile.html"), "https://www.threads.com/@nasa", "threads");
	assert.equal(meta.title, "NASA (@nasa) • Threads, Say more");
	assert.equal(meta.description, "12.8M Followers • 171 Threads • Making the seemingly impossible, possible. ✨. See the latest conversations with @nasa.");
});

test("an Instagram post that exposes only an image gives no_metadata", () => {
	const url = "https://www.instagram.com/p/DX8-276j8pS/";
	assert.deepEqual(failure(() => socialMeta(fixture("instagram-post.html"), url, "instagram")), { kind: "no_metadata", url, site: "instagram" });
});

test("a TikTok video page, which exposes nothing to a plain GET, gives no_metadata", () => {
	const url = "https://www.tiktok.com/@nasa/video/7665358680627399966";
	assert.deepEqual(failure(() => socialMeta(fixture("tiktok-video.html"), url, "tiktok")), { kind: "no_metadata", url, site: "tiktok" });
});

test("a page with a full article and no og: title or description gives no_metadata, not the article", () => {
	const url = "https://www.instagram.com/p/abc/";
	assert.deepEqual(failure(() => socialMeta(fixture("article.html"), url, "instagram")), { kind: "no_metadata", url, site: "instagram" });
});
