/**
 * web_search's client: one JSON-RPC `tools/call` of `web_search` on the Magpie gateway's `magpie-web-search` MCP server,
 * with no MCP session (Magpie answers a lone call in JSON). Magpie's text is returned unparsed: its format is Magpie's.
 * The gateway is a private address, reached with the global fetch, not with the public-only client of `http.ts`.
 */

import { WebToolError } from "./errors.ts";
import { USER_AGENT } from "./http.ts";

/** Magpie's own search has a limit inside this one; this one bounds a gateway that does not answer. */
export const SEARCH_TIMEOUT_MS = 60_000;

const SERVER_PATH = "/mcp/magpie/web-search";

const RECENCY_DAYS = { day: 1, week: 7, month: 30, year: 365 } as const;

export type SearchParams = { query: string; count?: number; freshness?: keyof typeof RECENCY_DAYS };

export type Gateway = { url: string; key: string };

/** The search endpoint from Pi's `magpie` provider: its baseUrl (models.json) and its key (auth.json). */
export function gatewayFrom(baseUrl: string | undefined, key: string | undefined): Gateway {
	if (!baseUrl) throw new WebToolError({ kind: "gateway_missing", what: "baseUrl" });
	if (!key) throw new WebToolError({ kind: "gateway_missing", what: "key" });
	try {
		return { url: new URL(SERVER_PATH, baseUrl).href, key };
	} catch (thrown) {
		throw new WebToolError({ kind: "invalid_url", url: baseUrl, reason: 'Pi\'s "magpie" provider baseUrl in models.json is not a URL' }, { cause: thrown });
	}
}

export async function search(params: SearchParams, gateway: Gateway, deps: { timeoutMs: number; signal?: AbortSignal }): Promise<string> {
	const deadline = AbortSignal.timeout(deps.timeoutMs);
	const signal = deps.signal ? AbortSignal.any([deps.signal, deadline]) : deadline;
	const args: Record<string, unknown> = { query: params.query };
	if (params.count !== undefined) args.count = params.count;
	if (params.freshness !== undefined) args.recency_days = RECENCY_DAYS[params.freshness];

	let status: number;
	let text: string;
	try {
		const res = await fetch(gateway.url, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${gateway.key}`,
				"Content-Type": "application/json",
				Accept: "application/json, text/event-stream",
				"User-Agent": USER_AGENT,
			},
			body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "web_search", arguments: args } }),
			signal,
		});
		status = res.status;
		text = await res.text();
	} catch (thrown) {
		if (deps.signal?.aborted) throw new WebToolError({ kind: "aborted" }, { cause: thrown });
		if (deadline.aborted) throw new WebToolError({ kind: "timeout", afterMs: deps.timeoutMs }, { cause: thrown });
		// fetch wraps the system error in a TypeError: the code and the message are on its cause.
		const system = (thrown as Error).cause as NodeJS.ErrnoException | undefined;
		if (typeof system?.code !== "string") throw thrown;
		throw new WebToolError({ kind: "network", code: system.code, message: messageOf(system) }, { cause: thrown });
	}
	return readReply(status, text);
}

/** A connection that failed on every address of a name is an AggregateError whose own message is empty. */
function messageOf(system: Error): string {
	if (system instanceof AggregateError) return system.errors.map((error) => (error as Error).message).join("; ");
	return system.message;
}

function readReply(status: number, text: string): string {
	const body = parseJson(text);
	if (status < 200 || status > 299) {
		throw new WebToolError({ kind: "gateway_refused", status, message: errorMessage(body) ?? (text.trim() === "" ? "the reply has no body" : text) });
	}
	if (typeof body !== "object" || body === null) throw badResponse("the reply is not a JSON object");
	const refusal = errorMessage(body);
	if (refusal !== undefined) throw new WebToolError({ kind: "gateway_refused", status, message: refusal });
	const result = (body as { result?: { content?: unknown; isError?: unknown } }).result;
	const content = Array.isArray(result?.content) ? (result.content as { type?: unknown; text?: unknown }[]) : [];
	const texts = content.filter((c) => c?.type === "text" && typeof c.text === "string").map((c) => c.text as string);
	if (texts.length === 0) throw badResponse("the result has no text");
	const joined = texts.join("\n\n");
	if (result?.isError === true) throw new WebToolError({ kind: "search_failed", message: joined });
	return joined;
}

function parseJson(text: string): unknown {
	try {
		return JSON.parse(text);
	} catch {
		// Not JSON: the callers say so (bad_response), or show the body itself (gateway_refused).
		return undefined;
	}
}

/** The message of Magpie's error, in its HTTP form or its JSON-RPC form: `{ error: { message } }`. */
function errorMessage(body: unknown): string | undefined {
	const message = (body as { error?: { message?: unknown } } | undefined)?.error?.message;
	return typeof message === "string" ? message : undefined;
}

function badResponse(what: string): WebToolError {
	return new WebToolError({ kind: "bad_response", from: "magpie", what });
}
