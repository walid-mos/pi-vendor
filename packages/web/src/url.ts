/**
 * Validates a URL before any request: http or https, no credentials, and no host that is known to be local without a
 * DNS lookup (an IP literal, `localhost`). Names that need DNS are checked at connect time by `http.ts`.
 */

import { isIP } from "node:net";

import { isPublicAddress } from "./address.ts";
import { WebToolError } from "./errors.ts";

/** `localhost` and its subdomains are loopback by definition (RFC 6761), whatever DNS would say. */
const LOOPBACK = "127.0.0.1";

export function parseTarget(input: string): URL {
	const trimmed = input.trim();
	if (!URL.canParse(trimmed)) throw new WebToolError({ kind: "invalid_url", url: input, reason: "not a URL" });
	const url = new URL(trimmed);
	if (url.protocol !== "http:" && url.protocol !== "https:") {
		throw new WebToolError({ kind: "invalid_url", url: input, reason: "only http and https are read" });
	}
	if (url.username || url.password) {
		throw new WebToolError({ kind: "invalid_url", url: input, reason: "a URL with a user name or password is refused" });
	}
	const host = url.hostname.replace(/^\[(.*)\]$/, "$1");
	if (host === "localhost" || host.endsWith(".localhost")) {
		throw new WebToolError({ kind: "blocked_address", host, address: LOOPBACK });
	}
	if (isIP(host) && !isPublicAddress(host)) throw new WebToolError({ kind: "blocked_address", host, address: host });
	return url;
}
