/**
 * The one error type of the web tools. Every expected failure is a `WebError`, thrown inside a `WebToolError` and
 * turned into a tool result by `tools.ts`; any other exception is a bug and propagates.
 */

export type WebError =
	| { kind: "gateway_missing"; what: "baseUrl" | "key" }
	| { kind: "gateway_refused"; status: number; message: string }
	| { kind: "search_failed"; message: string }
	| { kind: "bad_response"; from: "magpie" | "fxtwitter" | "tiktok_oembed"; what: string }
	| { kind: "invalid_url"; url: string; reason: string }
	| { kind: "blocked_address"; host: string; address: string }
	| { kind: "dns_failed"; host: string; code: string }
	| { kind: "network"; code: string; message: string }
	| { kind: "timeout"; afterMs: number }
	| { kind: "aborted" }
	| { kind: "too_many_redirects"; limit: number; chain: string[] }
	| { kind: "http_status"; status: number; url: string }
	| { kind: "too_large"; limitBytes: number }
	| { kind: "unsupported_content_type"; contentType: string }
	| { kind: "unsupported_charset"; charset: string }
	| { kind: "no_article"; url: string }
	| { kind: "option_not_supported"; option: "replies"; reason: string }
	| { kind: "pdf_unreadable"; reason: string }
	| { kind: "pdf_no_text"; pages: number }
	| { kind: "x_unavailable"; code: number; message: string }
	| { kind: "no_metadata"; url: string; site: string }
	| { kind: "media_host_blocked"; host: string }
	| { kind: "unsupported_media_type"; mimeType: string }
	| { kind: "image_undecodable" };

export class WebToolError extends Error {
	readonly error: WebError;

	constructor(error: WebError) {
		super(describe(error));
		this.name = "WebToolError";
		this.error = error;
	}
}

const BOUNDARY = "Local and private pages are opened with e2e instead.";

/** The model-facing sentence for an error, with the next action when there is one. */
export function describe(error: WebError): string {
	switch (error.kind) {
		case "gateway_missing":
			return error.what === "baseUrl"
				? 'Pi\'s "magpie" provider has no baseUrl in models.json, so web_search cannot reach the Magpie gateway.'
				: 'Pi\'s "magpie" provider has no key in auth.json, so web_search cannot call the Magpie gateway.';
		case "gateway_refused":
			return `The Magpie gateway refused the search (HTTP ${error.status}): ${error.message}`;
		case "search_failed":
			return `Magpie's web search failed: ${error.message}. Nothing else is tried.`;
		case "bad_response":
			return `Unexpected reply from ${error.from}: ${error.what}.`;
		case "invalid_url":
			return `Invalid URL ${error.url}: ${error.reason}.`;
		case "blocked_address":
			return `${error.host} resolves to ${error.address}, a local or private address, which fetch_content does not open. ${BOUNDARY}`;
		case "dns_failed":
			return `Could not resolve ${error.host} (${error.code}).`;
		case "network":
			return `Network error (${error.code}): ${error.message}`;
		case "timeout":
			return `Timed out after ${error.afterMs} ms.`;
		case "aborted":
			return "Aborted.";
		case "too_many_redirects":
			return `More than ${error.limit} redirects: ${error.chain.join(" -> ")}`;
		case "http_status":
			return `HTTP ${error.status} from ${error.url}.`;
		case "too_large":
			return `The response is larger than ${error.limitBytes} bytes, the limit for its type; nothing was returned.`;
		case "unsupported_content_type":
			return `Content type ${error.contentType} cannot be read as text.`;
		case "unsupported_charset":
			return `Unsupported character set ${error.charset}.`;
		case "no_article":
			return `No article found on ${error.url}. Call fetch_content again with mode: "page" to get the whole page.`;
		case "option_not_supported":
			return `The option ${error.option} is not supported here: ${error.reason}.`;
		case "pdf_unreadable":
			return `The PDF cannot be read: ${error.reason}.`;
		case "pdf_no_text":
			return `The PDF's ${error.pages} pages hold no text (a scan?); there is no OCR here.`;
		case "x_unavailable":
			return `FxTwitter, the third-party service that reads X posts, could not return this post (${error.code}: ${error.message}). Nothing else is tried.`;
		case "no_metadata":
			return `${error.url} exposes no title or description without JavaScript or a login. Its content needs e2e, with an agent account.`;
		case "media_host_blocked":
			return `Media host ${error.host} is not allowed.`;
		case "unsupported_media_type":
			return `Media type ${error.mimeType} is not an image that can be attached.`;
		case "image_undecodable":
			return "The image could not be decoded.";
		default: {
			const unhandled: never = error;
			throw new Error(`unknown web error kind "${(unhandled as { kind: string }).kind}"`);
		}
	}
}
