/**
 * The images of an X post: which ones are attached, in the order the text lists them, and their download through the
 * guarded client, restricted to FxTwitter's media hosts and to https. Resizing is the caller's (Pi's resizer).
 */

import { WebToolError } from "../errors.ts";
import { get, PRODUCTION, type Network } from "../http.ts";
import type { XPost, XStatus } from "./payload.ts";

/** Images sent to the model per post: each costs context, and each is a channel for injected instructions. */
export const MAX_IMAGES = 6;
/** Pi resizes what it attaches; a larger file is not a photo worth reading. */
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
/** Longest side of an attached image, after Pi's resizer. */
export const MAX_IMAGE_SIDE = 2000;
const IMAGE_TIMEOUT_MS = 15_000;
const IMAGE_REDIRECTS = 3;

/** The hosts FxTwitter's replies used for media, as recorded on 2026-11-26; no wildcard. */
const MEDIA_HOSTS = new Set(["pbs.twimg.com", "video.twimg.com", "mosaic.fxtwitter.com"]);

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

export type MediaRef = { label: string; url: string; altText?: string; durationS?: number };

export type LeftOut = { label: string; url?: string; altText?: string; durationS?: number; reason: string };

export type MediaDeps = { network: Network; isAllowedHost: (host: string) => boolean; httpsOnly: boolean };

export const PRODUCTION_MEDIA: MediaDeps = { network: PRODUCTION, isAllowedHost: isMediaHost, httpsOnly: true };

export function isMediaHost(host: string): boolean {
	return MEDIA_HOSTS.has(host.toLowerCase());
}

/** The root's media, then its quotes' (`quoted`, `quoted 2`…), then the thread posts' (`thread N`). */
export function collectMedia(post: XPost): { refs: MediaRef[]; leftOut: LeftOut[] } {
	const items: Item[] = [...statusMedia(post.root, "")];
	let depth = 1;
	for (let quote = post.root.quote; quote?.kind === "status"; quote = quote.quote, depth++) {
		items.push(...statusMedia(quote, depth === 1 ? "quoted " : `quoted ${depth} `));
	}
	post.thread.forEach((entry, i) => {
		if (entry.kind === "status") items.push(...statusMedia(entry, `thread ${i + 1} `));
	});

	const refs: MediaRef[] = [];
	const leftOut: LeftOut[] = [];
	const seen = new Set<string>();
	const numbers = new Map<string, number>();
	for (const { group, ...item } of items) {
		if (item.url !== undefined) {
			if (seen.has(item.url)) continue;
			seen.add(item.url);
		}
		const n = (numbers.get(group) ?? 0) + 1;
		numbers.set(group, n);
		const label = group.endsWith("card image") ? group : `${group} ${n}`;
		if (item.url === undefined) leftOut.push({ label, ...item, reason: "the video has no poster" });
		else if (refs.length === MAX_IMAGES) leftOut.push({ label, ...item, reason: `over the limit of ${MAX_IMAGES} images` });
		else refs.push({ label, ...item, url: item.url });
	}
	return { refs, leftOut };
}

/** An item before numbering: `group` is its label without the number, such as `quoted photo`. */
type Item = { group: string; url?: string; altText?: string; durationS?: number };

/** One status's items in the order of the text: photos, GIFs, video posters, then the card image. */
function statusMedia(status: XStatus, prefix: string): Item[] {
	const photos: Item[] = [];
	const gifs: Item[] = [];
	const videos: Item[] = [];
	for (const m of status.media) {
		if (m.kind === "video") videos.push(compact({ group: `${prefix}video`, url: m.posterUrl, durationS: m.durationS }));
		else (m.kind === "gif" ? gifs : photos).push(compact({ group: `${prefix}${m.kind === "gif" ? "GIF" : "photo"}`, url: m.url, altText: m.altText }));
	}
	const card: Item[] = status.cardImageUrl ? [{ group: `${prefix}card image`, url: status.cardImageUrl }] : [];
	return [...photos, ...gifs, ...videos, ...card];
}

function compact(item: Item): Item {
	return Object.fromEntries(Object.entries(item).filter(([, v]) => v !== undefined)) as Item;
}

export async function downloadImage(url: string, deps: MediaDeps, signal?: AbortSignal): Promise<{ bytes: Buffer; mimeType: string }> {
	if (!URL.canParse(url)) throw new WebToolError({ kind: "invalid_url", url, reason: "not a URL" });
	const fetched = await get(
		new URL(url),
		{
			timeoutMs: IMAGE_TIMEOUT_MS,
			maxRedirects: IMAGE_REDIRECTS,
			limitFor: () => MAX_IMAGE_BYTES,
			accept: "image/jpeg, image/png, image/gif, image/webp",
			signal,
			allowHost: deps.isAllowedHost,
			httpsOnly: deps.httpsOnly,
		},
		deps.network,
	);
	const mimeType = fetched.contentType.split(";")[0].trim().toLowerCase();
	if (!IMAGE_TYPES.has(mimeType)) throw new WebToolError({ kind: "unsupported_media_type", mimeType });
	return { bytes: fetched.body, mimeType };
}
