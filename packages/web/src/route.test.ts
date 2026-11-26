import assert from "node:assert/strict";
import { test } from "node:test";

import { routeFor, type Route } from "./route.ts";

const table: [string, Route][] = [
	["https://x.com/jack/status/20", { kind: "x_status", id: "20" }],
	["https://twitter.com/i/web/status/20", { kind: "x_status", id: "20" }],
	["https://mobile.twitter.com/jack/status/20?s=20", { kind: "x_status", id: "20" }],
	["https://fxtwitter.com/jack/status/20", { kind: "x_status", id: "20" }],
	["https://vxtwitter.com/i/status/1604617643973124097", { kind: "x_status", id: "1604617643973124097" }],
	["https://www.x.com/NASA/status/2125263043244290435/photo/1", { kind: "x_status", id: "2125263043244290435" }],
	["https://x.com/jack", { kind: "generic" }],
	["https://x.com/jack/status/abc", { kind: "generic" }],
	["https://x.com.evil.example/a/status/1", { kind: "generic" }],
	["https://notinstagram.com/p/x", { kind: "generic" }],
	["https://example.com/x.com/a/status/1", { kind: "generic" }],
	["https://www.instagram.com/p/abc/", { kind: "social_meta", site: "instagram" }],
	["https://instagr.am/p/abc", { kind: "social_meta", site: "instagram" }],
	["https://www.threads.net/@u/post/x", { kind: "social_meta", site: "threads" }],
	["https://threads.com/@u/post/x", { kind: "social_meta", site: "threads" }],
	["https://www.tiktok.com/@u/video/1", { kind: "social_meta", site: "tiktok" }],
	["https://vm.tiktok.com/abc/", { kind: "social_meta", site: "tiktok" }],
	["https://vt.tiktok.com/abc/", { kind: "social_meta", site: "tiktok" }],
	["https://example.com/", { kind: "generic" }],
];

for (const [url, route] of table) {
	test(`${url} routes to ${route.kind}`, () => {
		assert.deepEqual(routeFor(new URL(url)), route);
	});
}
