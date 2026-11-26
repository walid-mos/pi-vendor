/**
 * The one table that says which reading a URL gets in fetch_content's `article` mode, by host and path. Nothing else
 * selects a reading, and a failure of one route never tries another.
 */

export type SocialSite = "instagram" | "threads" | "tiktok";

export type Route = { kind: "x_status"; id: string } | { kind: "social_meta"; site: SocialSite } | { kind: "generic" };

const X_HOSTS = new Set(["x.com", "twitter.com", "fxtwitter.com", "vxtwitter.com"]);

/** `/<user>/status/<id>`, `/i/status/<id>`, `/i/web/status/<id>`, with anything after (`/photo/1`). */
const X_STATUS_PATH = /^\/(?:i\/web|i|[A-Za-z0-9_]{1,15})\/status\/(\d+)(?:\/|$)/;

const SOCIAL_HOSTS: Record<string, SocialSite> = {
	"instagram.com": "instagram",
	"instagr.am": "instagram",
	"threads.net": "threads",
	"threads.com": "threads",
	"tiktok.com": "tiktok",
	"vm.tiktok.com": "tiktok",
	"vt.tiktok.com": "tiktok",
};

export function routeFor(url: URL): Route {
	// Without the final dot of a fully qualified name (`x.com.`), as `url.ts` does, and without a `www.`-style prefix.
	const host = url.hostname.toLowerCase().replace(/\.$/, "").replace(/^(?:www|m|mobile)\./, "");
	if (X_HOSTS.has(host)) {
		const id = X_STATUS_PATH.exec(url.pathname)?.[1];
		return id ? { kind: "x_status", id } : { kind: "generic" };
	}
	const site = Object.hasOwn(SOCIAL_HOSTS, host) ? SOCIAL_HOSTS[host] : undefined;
	return site ? { kind: "social_meta", site } : { kind: "generic" };
}
