/**
 * An X post as the model reads it: the post, its quotes nested with `>`, the author's thread, the replies, then one
 * line per media item saying what was attached and what was not, and last what the caps left out. A count of 0 is
 * data and is shown.
 */

import { describe, type WebError } from "../errors.ts";
import type { XEntry, XPost, XStatus } from "./payload.ts";

export type MediaLine = {
	label: string;
	altText?: string;
	durationS?: number;
	outcome: { state: "attached" } | { state: "failed"; error: WebError } | { state: "left_out"; reason: string };
};

export function formatPost(post: XPost, media: MediaLine[]): string {
	const sections = [entryLines(post.root).join("\n")];
	if (post.thread.length > 0) {
		const more = post.thread.length === 1 ? "1 more post" : `${post.thread.length} more posts`;
		sections.push(`Thread by @${post.root.author.handle}, ${more}:`, ...post.thread.map((entry) => entryLines(entry).join("\n")));
	}
	if (post.replies) {
		sections.push(`Replies, ${post.replies.length} shown:`, ...post.replies.map((entry) => entryLines(entry).join("\n")));
	}
	if (media.length > 0) sections.push(["Media:", ...media.map(mediaLine)].join("\n"));
	const left = leftOut(post.dropped);
	if (left) sections.push(left);
	return sections.join("\n\n");
}

function entryLines(entry: XEntry): string[] {
	if (entry.kind === "unavailable") return [`An unavailable post (${entry.reason})${entry.url ? `: ${entry.url}` : ""}`];
	return statusLines(entry);
}

function statusLines(status: XStatus): string[] {
	const name = status.author.name && status.author.name !== status.author.handle ? ` (${status.author.name})` : "";
	const lines = [`@${status.author.handle}${name}${status.createdAt ? `, ${status.createdAt}` : ""}`, status.url];
	if (status.replyingTo) lines.push(`Replying to @${status.replyingTo}`);
	lines.push("", status.text);
	if (status.poll) {
		const votes = status.poll.totalVotes === undefined ? "" : `, ${status.poll.totalVotes} votes`;
		lines.push("", `Poll${votes}:`, ...status.poll.choices.map((c) => `- ${c.label}${c.count === undefined ? "" : `: ${c.count}`}`));
	}
	if (status.communityNote) lines.push("", `Community note: ${status.communityNote}`);
	const engagement = engagementLine(status.engagement);
	if (engagement) lines.push("", engagement);
	if (status.quote) lines.push("", "Quoting:", ...entryLines(status.quote).map((line) => (line ? `> ${line}` : ">")));
	return lines;
}

function engagementLine(e: XStatus["engagement"]): string {
	const parts: string[] = [];
	if (e.likes !== undefined) parts.push(`${e.likes} likes`);
	if (e.reposts !== undefined) parts.push(`${e.reposts} reposts`);
	if (e.replies !== undefined) parts.push(`${e.replies} replies`);
	if (e.views !== undefined) parts.push(`${e.views} views`);
	return parts.join(", ");
}

function mediaLine(m: MediaLine): string {
	const video = m.durationS === undefined ? "" : ` (a ${m.durationS} s video; the image is its poster)`;
	const alt = m.altText ? `: ${m.altText}` : "";
	switch (m.outcome.state) {
		case "attached":
			return `- ${m.label}${video}${alt}`;
		case "failed":
			return `- ${m.label}${video}: not attached (${describe(m.outcome.error)})`;
		case "left_out":
			return `- ${m.label}${video}: not attached (${m.outcome.reason})`;
	}
}

function leftOut(dropped: XPost["dropped"]): string | undefined {
	const parts: string[] = [];
	if (dropped.quotes > 0) parts.push(`${dropped.quotes} deeper ${dropped.quotes === 1 ? "quote" : "quotes"}`);
	if (dropped.thread > 0) parts.push(`${dropped.thread} thread ${dropped.thread === 1 ? "post" : "posts"}`);
	if (dropped.replies > 0) parts.push(`${dropped.replies} ${dropped.replies === 1 ? "reply" : "replies"}`);
	return parts.length > 0 ? `Left out by the limits: ${parts.join(", ")}.` : undefined;
}
