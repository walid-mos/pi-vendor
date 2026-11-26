import assert from "node:assert/strict";
import { test } from "node:test";

import { isPublicAddress } from "./address.ts";

const refused = [
	"127.0.0.1",
	"10.1.2.3",
	"100.64.0.1",
	"169.254.169.254",
	"192.168.1.1",
	"::1",
	"fd7a:115c:a1e0::1",
	"fe80::1",
	"::ffff:10.0.0.1",
	"64:ff9b::a00:1",
];

const accepted = ["1.1.1.1", "93.184.216.34", "2606:4700:4700::1111"];

for (const ip of refused) {
	test(`${ip} is not public`, () => {
		assert.equal(isPublicAddress(ip), false);
	});
}

for (const ip of accepted) {
	test(`${ip} is public`, () => {
		assert.equal(isPublicAddress(ip), true);
	});
}

test("something that is not an IP address is a bug", () => {
	assert.throws(() => isPublicAddress("example.com"), /not an IP address: example\.com/);
});
