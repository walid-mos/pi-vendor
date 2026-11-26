/**
 * The guarded HTTP client of fetch_content: GET only, redirects followed by hand, every hop validated again, the
 * address checked at connect time, a size limit counted after decompression, one deadline for the whole request.
 * It knows nothing about HTML, PDF or X.
 */

import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import { request as httpRequest, type IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";
import type { LookupFunction } from "node:net";
import { pipeline } from "node:stream/promises";
import { createBrotliDecompress, createGunzip, createInflate } from "node:zlib";

import { isPublicAddress } from "./address.ts";
import { messageOf, WebToolError, withDeadline } from "./errors.ts";
import { parseTarget } from "./url.ts";

/** Generic on purpose: nothing that identifies the user or a project. */
export const USER_AGENT = "Mozilla/5.0 (compatible; pi-web/1.0)";

const REDIRECTS = new Set([301, 302, 303, 307, 308]);

/** Codes that come from the name lookup itself, as opposed to the connection. */
const DNS_CODES = new Set(["ENOTFOUND", "EAI_AGAIN", "EAI_FAIL", "ENODATA", "ESERVFAIL"]);

export type Network = {
	/** May a socket connect to this address? Production: public addresses only. */
	isAllowedAddress: (ip: string) => boolean;
	lookup: LookupFunction;
};

export const PRODUCTION: Network = { isAllowedAddress: isPublicAddress, lookup: dnsLookup as LookupFunction };

export type GetOptions = {
	/** One deadline for the whole request, redirects and body included. */
	timeoutMs: number;
	maxRedirects: number;
	/** The body's size limit in bytes, chosen from the response's content type before the body is read. */
	limitFor: (contentType: string) => number;
	accept: string;
	signal?: AbortSignal;
	/** When set, every hop's host must pass it (the media hosts of X posts). */
	allowHost?: (host: string) => boolean;
	/** Every hop must be https (media). */
	httpsOnly?: boolean;
};

export type Fetched = {
	finalUrl: string;
	/** The URLs that answered with a redirect, in order. */
	redirects: string[];
	status: number;
	contentType: string;
	body: Buffer;
};

export async function get(url: URL, options: GetOptions, network: Network): Promise<Fetched> {
	const deadline = withDeadline(options.timeoutMs, options.signal);
	try {
		return await follow(url, options, network, deadline.signal);
	} catch (thrown) {
		throw deadline.rethrow(thrown);
	}
}

async function follow(start: URL, options: GetOptions, network: Network, signal: AbortSignal): Promise<Fetched> {
	const redirects: string[] = [];
	let url = checkHop(start.href, options, network);
	for (;;) {
		const res = await send(url, options, network, signal).catch((thrown: unknown) => {
			throw toWebToolError(thrown, url);
		});
		const status = res.statusCode ?? 0;
		const location = res.headers.location;
		if (REDIRECTS.has(status) && location) {
			// A body that is never read is dropped with its connection: reading it would bypass the size limit.
			res.destroy();
			if (!URL.canParse(location, url)) throw new WebToolError({ kind: "invalid_url", url: location, reason: "not a URL" });
			const next = new URL(location, url).href;
			if (redirects.length === options.maxRedirects) {
				throw new WebToolError({ kind: "too_many_redirects", limit: options.maxRedirects, chain: [...redirects, url.href, next] });
			}
			redirects.push(url.href);
			url = checkHop(next, options, network);
			continue;
		}
		if (status < 200 || status > 299) {
			res.destroy();
			throw new WebToolError({ kind: "http_status", status, url: url.href });
		}
		const contentType = res.headers["content-type"] ?? "";
		const body = await readBody(res, contentType, options.limitFor).catch((thrown: unknown) => {
			throw toWebToolError(thrown, url);
		});
		return { finalUrl: url.href, redirects, status, contentType, body };
	}
}

/** Scheme, credentials and IP-literal hosts (which no lookup sees), then the host allowlist, before any request. */
function checkHop(href: string, options: GetOptions, network: Network): URL {
	const url = parseTarget(href, network.isAllowedAddress);
	if (options.httpsOnly && url.protocol !== "https:") throw new WebToolError({ kind: "invalid_url", url: href, reason: "only https is read here" });
	if (options.allowHost && !options.allowHost(url.hostname)) {
		throw new WebToolError({ kind: "media_host_blocked", host: url.hostname });
	}
	return url;
}

function send(url: URL, options: GetOptions, network: Network, signal: AbortSignal): Promise<IncomingMessage> {
	const request = url.protocol === "https:" ? httpsRequest : httpRequest;
	return new Promise((resolve, reject) => {
		const req = request(url, {
			method: "GET",
			agent: false,
			lookup: guardedLookup(network),
			signal,
			headers: { "User-Agent": USER_AGENT, Accept: options.accept, "Accept-Encoding": "gzip, deflate, br" },
		});
		req.on("response", resolve);
		req.on("error", reject);
		req.end();
	});
}

/**
 * Resolves through the network's lookup and refuses the connection when any address is not allowed. The socket
 * connects to an address this function returned, so there is no window between the check and the connection.
 */
function guardedLookup(network: Network): LookupFunction {
	return ((hostname: string, options: { all?: boolean }, callback: (...args: unknown[]) => void) => {
		network.lookup(hostname, { ...options, all: true }, ((error: NodeJS.ErrnoException | null, addresses: LookupAddress[]) => {
			if (error) return callback(error);
			const refused = addresses.find((a) => !network.isAllowedAddress(a.address));
			if (refused) return callback(new WebToolError({ kind: "blocked_address", host: hostname, address: refused.address }));
			if (addresses.length === 0) return callback(Object.assign(new Error(`no address for ${hostname}`), { code: "ENODATA" }));
			if (options.all) return callback(null, addresses);
			return callback(null, addresses[0].address, addresses[0].family);
		}) as never);
	}) as LookupFunction;
}

/** The decompressed body, up to the limit chosen for its content type. Whenever this fails, the response is destroyed. */
async function readBody(res: IncomingMessage, contentType: string, limitFor: GetOptions["limitFor"]): Promise<Buffer> {
	try {
		const limit = limitFor(contentType);
		const declared = Number(res.headers["content-length"]);
		if (declared > limit) throw new WebToolError({ kind: "too_large", limitBytes: limit });
		const chunks: Buffer[] = [];
		let size = 0;
		await pipeline(res, ...decoders(res.headers["content-encoding"]), async (source: AsyncIterable<Buffer>) => {
			for await (const chunk of source) {
				size += chunk.length;
				if (size > limit) throw new WebToolError({ kind: "too_large", limitBytes: limit });
				chunks.push(chunk);
			}
		});
		return Buffer.concat(chunks);
	} catch (thrown) {
		res.destroy();
		throw thrown;
	}
}

function decoders(encoding: string | undefined) {
	switch (encoding?.trim().toLowerCase()) {
		case undefined:
		case "":
		case "identity":
			return [];
		case "gzip":
		case "x-gzip":
			return [createGunzip()];
		case "deflate":
			return [createInflate()];
		case "br":
			return [createBrotliDecompress()];
		default:
			throw new WebToolError({ kind: "network", code: "unsupported_encoding", message: `the server sent Content-Encoding ${encoding}` });
	}
}

/** A system error of one hop as a WebError; anything else is returned as it is (a bug, or already a WebToolError). */
function toWebToolError(thrown: unknown, url: URL): unknown {
	if (thrown instanceof WebToolError) return thrown;
	const code = (thrown as NodeJS.ErrnoException | undefined)?.code;
	if (typeof code !== "string") return thrown;
	if (DNS_CODES.has(code)) return new WebToolError({ kind: "dns_failed", host: url.hostname, code }, { cause: thrown });
	return new WebToolError({ kind: "network", code, message: messageOf(thrown as Error) }, { cause: thrown });
}

export function mimeOf(contentType: string): string {
	return contentType.split(";")[0].trim().toLowerCase();
}
