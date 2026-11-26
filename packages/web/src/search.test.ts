import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { test, type TestContext } from "node:test";

import { WebToolError, type WebError } from "./errors.ts";
import { gatewayFrom, search, type Gateway } from "./search.ts";

const fixture = (name: string) => readFileSync(new URL(`fixtures/${name}`, import.meta.url), "utf8");

type Recorded = { req: IncomingMessage; body: string };
type Reply = { status?: number; contentType?: string; body?: string; stall?: boolean };

/** A local stand-in for Magpie's gateway, answering every request with `reply`. */
async function magpie(t: TestContext, reply: Reply): Promise<{ gateway: Gateway; recorded: Recorded[] }> {
	const recorded: Recorded[] = [];
	const server = createServer(async (req, res) => {
		let body = "";
		for await (const chunk of req) body += chunk;
		recorded.push({ req, body });
		if (reply.stall) return;
		res.writeHead(reply.status ?? 200, { "Content-Type": reply.contentType ?? "application/json" }).end(reply.body ?? "");
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	t.after(() => {
		server.closeAllConnections();
		server.close();
	});
	const { port } = server.address() as AddressInfo;
	return { gateway: gatewayFrom(`http://127.0.0.1:${port}/v1`, "sk-test-key"), recorded };
}

async function failure(promise: Promise<unknown>): Promise<WebError> {
	try {
		await promise;
	} catch (thrown) {
		if (thrown instanceof WebToolError) return thrown.error;
		throw thrown;
	}
	assert.fail("the search succeeded");
}

const deps = { timeoutMs: 5000 };

test("gatewayFrom builds the web-search endpoint from a baseUrl that ends in /v1", () => {
	assert.deepEqual(gatewayFrom("https://magpie.example.net/v1", "sk-1"), { url: "https://magpie.example.net/mcp/magpie/web-search", key: "sk-1" });
});

test("gatewayFrom without a baseUrl or a key gives gateway_missing naming which", () => {
	assert.throws(() => gatewayFrom(undefined, "sk-1"), (e: unknown) => e instanceof WebToolError && e.error.kind === "gateway_missing" && e.error.what === "baseUrl");
	assert.throws(() => gatewayFrom("https://magpie.example.net/v1", undefined), (e: unknown) => e instanceof WebToolError && e.error.kind === "gateway_missing" && e.error.what === "key");
	assert.throws(() => gatewayFrom("https://magpie.example.net/v1", ""), (e: unknown) => e instanceof WebToolError && e.error.kind === "gateway_missing" && e.error.what === "key");
});

test("gatewayFrom with a baseUrl that is not a URL gives invalid_url instead of a bare TypeError", () => {
	assert.throws(() => gatewayFrom("magpie.example.net/v1", "sk-1"), (e: unknown) => e instanceof WebToolError && e.error.kind === "invalid_url" && e.error.url === "magpie.example.net/v1");
});

test("the key travels in Authorization: Bearer, never in the URL or the body", async (t) => {
	const { gateway, recorded } = await magpie(t, { body: fixture("magpie-search-ok.json") });
	await search({ query: "rule of twelfths tide" }, gateway, deps);
	const [{ req, body }] = recorded;
	assert.equal(req.headers.authorization, "Bearer sk-test-key");
	assert.doesNotMatch(req.url ?? "", /sk-test-key/);
	assert.doesNotMatch(body, /sk-test-key/);
	assert.equal(req.url, "/mcp/magpie/web-search");
	assert.equal(req.method, "POST");
});

test("the body is a JSON-RPC tools/call of web_search with the query, the count and recency_days for freshness", async (t) => {
	const { gateway, recorded } = await magpie(t, { body: fixture("magpie-search-ok.json") });
	await search({ query: "rule of twelfths tide", count: 2, freshness: "week" }, gateway, deps);
	assert.deepEqual(JSON.parse(recorded[0].body), {
		jsonrpc: "2.0",
		id: 1,
		method: "tools/call",
		params: { name: "web_search", arguments: { query: "rule of twelfths tide", count: 2, recency_days: 7 } },
	});
});

test("without count or freshness, neither is sent", async (t) => {
	const { gateway, recorded } = await magpie(t, { body: fixture("magpie-search-ok.json") });
	await search({ query: "tides" }, gateway, deps);
	assert.deepEqual(JSON.parse(recorded[0].body).params.arguments, { query: "tides" });
});

test("each freshness is sent as its number of days", async (t) => {
	const { gateway, recorded } = await magpie(t, { body: fixture("magpie-search-ok.json") });
	for (const freshness of ["day", "month", "year"] as const) await search({ query: "tides", freshness }, gateway, deps);
	assert.deepEqual(
		recorded.map((r) => JSON.parse(r.body).params.arguments.recency_days),
		[1, 30, 365],
	);
});

test("a recorded success yields its text unchanged", async (t) => {
	const { gateway } = await magpie(t, { body: fixture("magpie-search-ok.json") });
	const text = await search({ query: "rule of twelfths tide" }, gateway, deps);
	assert.equal(text, JSON.parse(fixture("magpie-search-ok.json")).result.content[0].text);
});

test("the recorded SearXNG failure gives search_failed with Magpie's text", async (t) => {
	const { gateway } = await magpie(t, { body: fixture("magpie-searxng-down.json") });
	const error = await failure(search({ query: "rule of twelfths tide" }, gateway, deps));
	assert.equal(error.kind, "search_failed");
	assert.match((error as { message: string }).message, /^magpie couldn't search the web: SearXNG: .*connect: connection refused$/);
});

test("a JSON-RPC error gives gateway_refused with its message", async (t) => {
	const { gateway } = await magpie(t, { body: fixture("magpie-jsonrpc-refused.json") });
	const error = await failure(search({ query: "tides" }, gateway, deps));
	assert.equal(error.kind, "gateway_refused");
	assert.equal((error as { status: number }).status, 200);
	assert.match((error as { message: string }).message, /may not use the MCP server magpie-web-search/);
});

test("a 401 with Magpie's JSON error gives gateway_refused with status 401 and its message", async (t) => {
	const { gateway } = await magpie(t, { status: 401, body: fixture("magpie-401.json") });
	assert.deepEqual(await failure(search({ query: "tides" }, gateway, deps)), {
		kind: "gateway_refused",
		status: 401,
		message: "the API key sent is not an enabled magpie gateway key: it is disabled, removed or mistyped",
	});
});

test("an HTTP error with a body that is not JSON gives gateway_refused with that body", async (t) => {
	const { gateway } = await magpie(t, { status: 502, contentType: "text/plain", body: "Bad Gateway" });
	assert.deepEqual(await failure(search({ query: "tides" }, gateway, deps)), { kind: "gateway_refused", status: 502, message: "Bad Gateway" });
});

test("an HTTP error with an empty body gives gateway_refused saying the body is empty", async (t) => {
	const { gateway } = await magpie(t, { status: 502, contentType: "text/plain", body: "" });
	assert.deepEqual(await failure(search({ query: "tides" }, gateway, deps)), { kind: "gateway_refused", status: 502, message: "the reply has no body" });
});

test("a body that is not JSON gives bad_response from magpie", async (t) => {
	const { gateway } = await magpie(t, { contentType: "text/html", body: "<html>login</html>" });
	assert.equal((await failure(search({ query: "tides" }, gateway, deps))).kind, "bad_response");
});

test("a body that is JSON null gives bad_response from magpie", async (t) => {
	const { gateway } = await magpie(t, { body: "null" });
	assert.equal((await failure(search({ query: "tides" }, gateway, deps))).kind, "bad_response");
});

test("a content block that is null is skipped like any block that is not text", async (t) => {
	const { gateway } = await magpie(t, { body: JSON.stringify({ jsonrpc: "2.0", id: 1, result: { content: [null, { type: "text", text: "1. Tides" }] } }) });
	assert.equal(await search({ query: "tides" }, gateway, deps), "1. Tides");
});

test("a result with no text block gives bad_response from magpie", async (t) => {
	const { gateway } = await magpie(t, { body: JSON.stringify({ jsonrpc: "2.0", id: 1, result: { content: [{ type: "image", data: "", mimeType: "image/png" }] } }) });
	const error = await failure(search({ query: "tides" }, gateway, deps));
	assert.deepEqual(error, { kind: "bad_response", from: "magpie", what: "the result has no text" });
});

test("a stall gives timeout", async (t) => {
	const { gateway } = await magpie(t, { stall: true });
	assert.deepEqual(await failure(search({ query: "tides" }, gateway, { timeoutMs: 200 })), { kind: "timeout", afterMs: 200 });
});

test("the caller's abort gives aborted", async (t) => {
	const { gateway } = await magpie(t, { stall: true });
	const controller = new AbortController();
	setTimeout(() => controller.abort(), 50);
	assert.deepEqual(await failure(search({ query: "tides" }, gateway, { timeoutMs: 5000, signal: controller.signal })), { kind: "aborted" });
});

test("a gateway that cannot be reached gives network with the system code", async () => {
	const server = createServer();
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const { port } = server.address() as AddressInfo;
	await new Promise((resolve) => server.close(resolve));
	const error = await failure(search({ query: "tides" }, gatewayFrom(`http://127.0.0.1:${port}/v1`, "sk-1"), deps));
	assert.equal(error.kind, "network");
	assert.equal((error as { code: string }).code, "ECONNREFUSED");
});

test("a name that fails on every one of its addresses gives network with their messages, not an empty one", async () => {
	const server = createServer();
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const { port } = server.address() as AddressInfo;
	await new Promise((resolve) => server.close(resolve));
	const error = await failure(search({ query: "tides" }, gatewayFrom(`http://localhost:${port}/v1`, "sk-1"), deps));
	assert.equal(error.kind, "network");
	assert.match((error as { message: string }).message, /ECONNREFUSED/);
});

test("a redirect from the gateway is not followed: gateway_refused with its status, and the target receives nothing", async (t) => {
	const target = await magpie(t, { body: fixture("magpie-search-ok.json") });
	const redirecting = createServer((_req, res) => res.writeHead(307, { Location: target.gateway.url }).end());
	await new Promise<void>((resolve) => redirecting.listen(0, "127.0.0.1", resolve));
	t.after(() => redirecting.close());
	const { port } = redirecting.address() as AddressInfo;
	const error = await failure(search({ query: "tides" }, { url: `http://127.0.0.1:${port}/mcp/magpie/web-search`, key: "sk-test-key" }, deps));
	assert.equal(error.kind, "gateway_refused");
	assert.equal((error as { status: number }).status, 307);
	assert.equal(target.recorded.length, 0);
});
