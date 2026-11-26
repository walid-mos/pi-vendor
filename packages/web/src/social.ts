/**
 * What an Instagram, Threads or TikTok page exposes to a plain GET: its `og:` tags. Their content itself is behind
 * JavaScript or a login, which is e2e's job. Readability is never run on these pages.
 */

import { parseHTML } from "linkedom";

import { WebToolError } from "./errors.ts";
import type { SocialSite } from "./route.ts";

export type SocialMeta = {
	site: SocialSite;
	title?: string;
	description?: string;
	/** Returned as a URL in the text; not downloaded. */
	imageUrl?: string;
};

export function socialMeta(html: string, url: string, site: SocialSite): SocialMeta {
	const { document } = parseHTML(html);
	const og = (name: string): string | undefined => {
		const value = document.querySelector(`meta[property="og:${name}"]`)?.getAttribute("content")?.trim();
		return value ? value : undefined;
	};
	const meta: SocialMeta = { site, title: og("title"), description: og("description"), imageUrl: og("image") };
	if (!meta.title && !meta.description) throw new WebToolError({ kind: "no_metadata", url, site });
	return meta;
}
