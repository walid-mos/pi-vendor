/**
 * FxTwitter's JSON (`/2/thread/<id>`, and `/2/conversation/<id>` for the replies) decoded into one typed post, with
 * the caps applied and what they left out counted. Anything that does not have the documented shape is bad_response;
 * FxTwitter's own error reply is x_unavailable. No network here.
 */

import { WebToolError } from "../errors.ts";

/** Quotes of quotes: the model rarely needs more than three levels to follow a conversation. */
export const MAX_QUOTE_DEPTH = 3;
/** The author's thread around the post, root excluded. */
export const MAX_THREAD_STATUSES = 10;
/** Replies with `replies: true`: FxTwitter's first page is enough to see what people answered. */
export const MAX_REPLIES = 20;
/** Text of each quoted, threaded or replied post; the post that was asked for is never cut. */
export const MAX_SUBSTATUS_CHARS = 4000;

export type XMedia =
	| { kind: "photo" | "gif"; url: string; altText?: string }
	| { kind: "video"; posterUrl?: string; durationS?: number };

export type XPoll = { totalVotes?: number; choices: { label: string; count?: number }[] };

export type XStatus = {
	kind: "status";
	id: string;
	url: string;
	author: { handle: string; name?: string };
	text: string;
	createdAt?: string;
	replyingTo?: string;
	engagement: { likes?: number; reposts?: number; replies?: number; views?: number };
	poll?: XPoll;
	communityNote?: string;
	media: XMedia[];
	cardImageUrl?: string;
	quote?: XEntry;
};

/** A post FxTwitter cannot show (deleted, suspended, private…). */
export type XUnavailable = { kind: "unavailable"; reason: string; url?: string };

export type XEntry = XStatus | XUnavailable;

export type XPost = {
	root: XStatus;
	thread: XEntry[];
	replies?: XEntry[];
	dropped: { quotes: number; thread: number; replies: number };
};

type Json = Record<string, unknown>;

/** `thread` is the reply of `/2/thread/<id>`; `conversation`, of `/2/conversation/<id>`, only when replies are asked. */
export function decodePost(thread: unknown, conversation?: unknown): XPost {
	const top = reply(thread);
	const dropped = { quotes: 0, thread: 0, replies: 0 };
	const root = decodeStatus(object(top.status, "status"), "status", { depth: 0, cut: false, dropped });

	const others = array(top.thread, "thread")
		.map((entry, i) => decodeEntry(entry, `thread[${i}]`, dropped))
		.filter((entry) => entry.kind !== "status" || entry.id !== root.id);
	dropped.thread = Math.max(0, others.length - MAX_THREAD_STATUSES);
	const post: XPost = { root, thread: others.slice(0, MAX_THREAD_STATUSES), dropped };

	if (conversation !== undefined) {
		const inThread = new Set(others.map((entry) => (entry.kind === "status" ? entry.id : "")));
		const replies = array(reply(conversation).replies, "replies")
			.map((entry, i) => decodeEntry(entry, `replies[${i}]`, dropped))
			.filter((entry) => entry.kind !== "status" || (entry.id !== root.id && !inThread.has(entry.id)));
		dropped.replies = Math.max(0, replies.length - MAX_REPLIES);
		post.replies = replies.slice(0, MAX_REPLIES);
	}
	return post;
}

/** The top level of a reply: FxTwitter's `code` other than 200 is its own error. */
function reply(body: unknown): Json {
	if (typeof body !== "object" || body === null || Array.isArray(body)) throw bad("the reply is not an object");
	const top = body as Json;
	if (top.code !== 200) {
		const code = typeof top.code === "number" ? top.code : 0;
		const message = typeof top.message === "string" && top.message ? top.message : code === 404 ? "not found" : "no message";
		throw new WebToolError({ kind: "x_unavailable", code, message });
	}
	return top;
}

type Context = { depth: number; cut: boolean; dropped: XPost["dropped"] };

/** A post of the thread or of the replies: its text is cut, and its quotes count from its own level. */
function decodeEntry(value: unknown, path: string, dropped: XPost["dropped"]): XEntry {
	const json = object(value, path);
	if (json.type === "tombstone") return unavailable(json, path);
	return decodeStatus(json, path, { depth: 0, cut: true, dropped });
}

function decodeStatus(json: Json, path: string, context: Context): XStatus {
	const author = object(json.author, `${path}.author`);
	const text = string(json.text, `${path}.text`);
	const status: XStatus = {
		kind: "status",
		id: string(json.id, `${path}.id`),
		url: string(json.url, `${path}.url`),
		author: { handle: string(author.screen_name, `${path}.author.screen_name`), name: optionalString(author.name, `${path}.author.name`) },
		text: context.cut ? cut(text) : text,
		createdAt: optionalString(json.created_at, `${path}.created_at`),
		engagement: compact({
			likes: count(json.likes, `${path}.likes`),
			reposts: count(json.reposts, `${path}.reposts`),
			replies: count(json.replies, `${path}.replies`),
			views: count(json.views, `${path}.views`),
		}),
		media: decodeMedia(json.media, `${path}.media`),
	};
	if (json.replying_to != null) status.replyingTo = string(object(json.replying_to, `${path}.replying_to`).screen_name, `${path}.replying_to.screen_name`);
	if (json.poll != null) status.poll = decodePoll(object(json.poll, `${path}.poll`), `${path}.poll`);
	if (json.community_note != null) status.communityNote = string(object(json.community_note, `${path}.community_note`).text, `${path}.community_note.text`);
	if (json.card != null) {
		const image = object(json.card, `${path}.card`).image;
		if (image != null) status.cardImageUrl = string(object(image, `${path}.card.image`).url, `${path}.card.image.url`);
	}
	if (json.quote != null) {
		if (context.depth >= MAX_QUOTE_DEPTH) context.dropped.quotes += 1 + quoteDepth(json.quote);
		else {
			const quote = object(json.quote, `${path}.quote`);
			status.quote = quote.type === "tombstone" ? unavailable(quote, `${path}.quote`) : decodeStatus(quote, `${path}.quote`, { ...context, depth: context.depth + 1, cut: true });
		}
	}
	return status;
}

/** How many quotes sit below this one, counted without decoding them. */
function quoteDepth(quote: unknown): number {
	let depth = 0;
	for (let q = (quote as Json | null)?.quote; q != null; q = (q as Json).quote) depth++;
	return depth;
}

function decodeMedia(value: unknown, path: string): XMedia[] {
	if (value == null) return [];
	const media = object(value, path);
	const out: XMedia[] = [];
	for (const [i, photo] of array(media.photos ?? [], `${path}.photos`).entries()) {
		const p = object(photo, `${path}.photos[${i}]`);
		const kind = p.type === "gif" ? "gif" : "photo";
		out.push(compact({ kind, url: string(p.url, `${path}.photos[${i}].url`), altText: optionalString(p.altText, `${path}.photos[${i}].altText`) }) as XMedia);
	}
	for (const [i, video] of array(media.videos ?? [], `${path}.videos`).entries()) {
		const v = object(video, `${path}.videos[${i}]`);
		const poster = optionalString(v.thumbnail_url, `${path}.videos[${i}].thumbnail_url`);
		// An animated GIF comes as a looping video: its poster is the image of the GIF.
		if (v.type === "gif") {
			if (poster) out.push({ kind: "gif", url: poster });
			continue;
		}
		out.push(compact({ kind: "video", posterUrl: poster, durationS: count(v.duration, `${path}.videos[${i}].duration`) }) as XMedia);
	}
	return out;
}

function decodePoll(poll: Json, path: string): XPoll {
	return compact({
		totalVotes: count(poll.total_votes, `${path}.total_votes`),
		choices: array(poll.choices, `${path}.choices`).map((choice, i) => {
			const c = object(choice, `${path}.choices[${i}]`);
			return compact({ label: string(c.label, `${path}.choices[${i}].label`), count: count(c.count, `${path}.choices[${i}].count`) });
		}),
	}) as XPoll;
}

function unavailable(json: Json, path: string): XUnavailable {
	return compact({ kind: "unavailable" as const, reason: optionalString(json.reason, `${path}.reason`) ?? "unavailable", url: optionalString(json.url, `${path}.url`) }) as XUnavailable;
}

function cut(text: string): string {
	if (text.length <= MAX_SUBSTATUS_CHARS) return text;
	return `${text.slice(0, MAX_SUBSTATUS_CHARS).toWellFormed()}… (${text.length - MAX_SUBSTATUS_CHARS} more characters)`;
}

function bad(what: string): WebToolError {
	return new WebToolError({ kind: "bad_response", from: "fxtwitter", what });
}

function object(value: unknown, path: string): Json {
	if (typeof value !== "object" || value === null || Array.isArray(value)) throw bad(`${path} is not an object`);
	return value as Json;
}

function array(value: unknown, path: string): unknown[] {
	if (!Array.isArray(value)) throw bad(`${path} is not a list`);
	return value;
}

function string(value: unknown, path: string): string {
	if (typeof value !== "string") throw bad(`${path} is not a string`);
	return value;
}

function optionalString(value: unknown, path: string): string | undefined {
	if (value == null || value === "") return undefined;
	return string(value, path);
}

/** A count FxTwitter may leave out or set to null (views of old posts); 0 is a count. */
function count(value: unknown, path: string): number | undefined {
	if (value == null) return undefined;
	if (typeof value !== "number") throw bad(`${path} is not a number`);
	return value;
}

/** The object without its undefined fields, so that what is absent is absent. */
function compact<T extends object>(value: T): T {
	return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T;
}
