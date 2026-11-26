import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const SCRIPT = fileURLToPath(new URL("../start-page.mjs", import.meta.url));

async function freePort() {
	const server = createServer();
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	const { port } = server.address();
	await new Promise((resolve) => server.close(resolve));
	return port;
}

/** Starts the script, killed when the test ends; `exit` resolves with its exit code and the whole of its stderr. */
function start(t, script, args) {
	const child = spawn(process.execPath, [script, ...args], { stdio: ["ignore", "ignore", "pipe"] });
	let stderr = "";
	child.stderr.on("data", (chunk) => (stderr += chunk));
	// `close`, not `exit`: `exit` can come before the last of stderr has been read.
	const exit = new Promise((resolve) => child.on("close", (code) => resolve({ code, stderr })));
	t.after(() => child.kill());
	return { exit };
}

async function waitForListener(port) {
	for (let i = 0; i < 50; i++) {
		try {
			await fetch(`http://127.0.0.1:${port}/`);
			return;
		} catch (error) {
			// Refused until the script listens; any other failure is the test's to report.
			if (error.cause?.code !== "ECONNREFUSED") throw error;
			await new Promise((resolve) => setTimeout(resolve, 100));
		}
	}
	assert.fail(`nothing listens on ${port}`);
}

test("every path answers 200 with the title, a heading and the word navigate", async (t) => {
	const port = await freePort();
	start(t, SCRIPT, [String(port)]);
	await waitForListener(port);
	for (const path of ["/", "/some/other/path?x=1"]) {
		const res = await fetch(`http://127.0.0.1:${port}${path}`);
		assert.equal(res.status, 200);
		const body = await res.text();
		assert.match(body, /<title>e2e start page<\/title>/);
		assert.match(body, /<h1>/);
		assert.match(body, /\bnavigate\b/);
	}
});

test("it listens on 127.0.0.1 only", async (t) => {
	const port = await freePort();
	start(t, SCRIPT, [String(port)]);
	await waitForListener(port);
	const lsof = execFileSync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN"], { encoding: "utf8" });
	assert.match(lsof, new RegExp(`127\\.0\\.0\\.1:${port}`));
	assert.doesNotMatch(lsof, new RegExp(`\\*:${port}`));
});

for (const args of [[], ["abc"]]) {
	test(`with ${args.length ? `"${args[0]}"` : "no argument"}, it exits non-zero and prints the usage`, async (t) => {
		const { exit } = start(t, SCRIPT, args);
		const { code, stderr } = await exit;
		assert.notEqual(code, 0);
		assert.match(stderr, /usage: start-page\.mjs <port>/);
	});
}

test("without the title file beside it, it exits non-zero naming the file", async (t) => {
	const dir = mkdtempSync(join(tmpdir(), "start-page-"));
	t.after(() => rmSync(dir, { recursive: true }));
	copyFileSync(SCRIPT, join(dir, "start-page.mjs"));
	const { exit } = start(t, join(dir, "start-page.mjs"), [String(await freePort())]);
	const { code, stderr } = await exit;
	assert.notEqual(code, 0);
	assert.match(stderr, /start-page-title\.txt/);
});
