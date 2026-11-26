import assert from "node:assert/strict";
import { test } from "node:test";

import { WebToolError, type WebError } from "./errors.ts";
import { parseTarget } from "./url.ts";

function refusal(input: string): WebError {
	try {
		parseTarget(input);
	} catch (thrown) {
		if (thrown instanceof WebToolError) return thrown.error;
		throw thrown;
	}
	assert.fail(`${input} was accepted`);
}

const invalid: [string, string][] = [
	["file:///etc/passwd", "only http and https are read"],
	["ftp://example.com/file", "only http and https are read"],
	["javascript:alert(1)", "only http and https are read"],
	["https://user:secret@example.com/", "a URL with a user name or password is refused"],
	["not a url", "not a URL"],
];

for (const [input, reason] of invalid) {
	test(`${input} is invalid: ${reason}`, () => {
		assert.deepEqual(refusal(input), { kind: "invalid_url", url: input, reason });
	});
}

const blocked: [string, string, string][] = [
	["http://localhost:5175", "localhost", "127.0.0.1"],
	["http://app.localhost/", "app.localhost", "127.0.0.1"],
	["http://localhost./", "localhost", "127.0.0.1"],
	["http://app.localhost./", "app.localhost", "127.0.0.1"],
	["http://[::1]/", "::1", "::1"],
	["http://2130706433/", "127.0.0.1", "127.0.0.1"],
	["http://0x7f.1/", "127.0.0.1", "127.0.0.1"],
	["http://169.254.169.254/latest/meta-data/", "169.254.169.254", "169.254.169.254"],
];

for (const [input, host, address] of blocked) {
	test(`${input} is a blocked address`, () => {
		assert.deepEqual(refusal(input), { kind: "blocked_address", host, address });
	});
}

test("an ordinary https URL is accepted and normalized", () => {
	assert.equal(parseTarget("  HTTPS://Example.COM/a b?q=1 ").href, "https://example.com/a%20b?q=1");
});

test("a public IP literal is accepted", () => {
	assert.equal(parseTarget("http://1.1.1.1/").href, "http://1.1.1.1/");
});
