/**
 * What the two tools look like in Pi's transcript, as pure functions of the arguments or the result. The grammar:
 * the call line is the tool's label in `toolTitle` bold, the target in `accent`, options in `muted`; a collapsed
 * result is one `muted` line; an expanded one is the text in `toolOutput`; a failure is its sentence in `error`.
 */

import { describe, type WebError } from "./errors.ts";
import type { FetchDetails, SearchDetails } from "./tools.ts";

export type Role = "toolTitle" | "accent" | "muted" | "toolOutput" | "error";

export type Theme = { fg(role: Role, text: string): string; bold(text: string): string };

type Rendered<D> = { content: { type: string; text?: string }[]; details: D | undefined };

/** Lines of a fetched text shown when the result is expanded. */
const EXPANDED_LINES = 20;

const FRESHNESS = { day: "past day", week: "past week", month: "past month", year: "past year" } as const;

export function renderSearchCall(args: { query?: string; count?: number; freshness?: keyof typeof FRESHNESS }, theme: Theme): string {
	const options = [args.count !== undefined ? `${args.count} results` : undefined, args.freshness ? FRESHNESS[args.freshness] : undefined].filter(Boolean);
	return callLine("Web search", args.query ?? "", options as string[], theme);
}

export function renderFetchCall(args: { url?: string; mode?: "article" | "page"; replies?: boolean }, theme: Theme): string {
	const options = [args.mode === "page" ? "whole page" : undefined, args.replies ? "with replies" : undefined].filter(Boolean);
	return callLine("Fetch content", args.url ?? "", options as string[], theme);
}

export function renderSearchResult(result: Rendered<SearchDetails>, expanded: boolean, theme: Theme): string {
	const details = result.details;
	if (!details) return theme.fg("muted", "…");
	if (!details.ok) return theme.fg("error", failureText(details.error, result));
	const text = textOf(result);
	return expanded ? theme.fg("toolOutput", text) : theme.fg("muted", text.split("\n")[0]);
}

export function renderFetchResult(result: Rendered<FetchDetails>, expanded: boolean, theme: Theme): string {
	const details = result.details;
	if (!details) return theme.fg("muted", "…");
	if (!details.ok) return theme.fg("error", failureText(details.error, result));
	if (expanded) {
		const lines = textOf(result).split("\n");
		const shown = theme.fg("toolOutput", lines.slice(0, EXPANDED_LINES).join("\n"));
		return lines.length > EXPANDED_LINES ? `${shown}\n${theme.fg("muted", `… ${lines.length - EXPANDED_LINES} more lines`)}` : shown;
	}
	switch (details.kind) {
		case "article":
		case "page":
		case "text":
			return theme.fg("muted", `${details.title ?? details.finalUrl} · ${size(details.bytes)}`);
		case "pdf": {
			const pages = details.pagesExtracted < details.pagesTotal ? `pages 1 to ${details.pagesExtracted} of ${details.pagesTotal}` : `${details.pagesTotal} ${details.pagesTotal === 1 ? "page" : "pages"}`;
			return theme.fg("muted", `${details.title ?? details.finalUrl} · ${pages}`);
		}
		case "x_status": {
			const attached = details.media.filter((m) => m.state === "attached").length;
			const failed = details.media.filter((m) => m.state === "failed").length;
			const line = theme.fg("muted", `@${details.author} · ${attached} ${attached === 1 ? "image" : "images"}`);
			return failed > 0 ? `${line} ${theme.fg("error", `${failed} not attached`)}` : line;
		}
		case "social_meta":
			return theme.fg("muted", [details.meta.site, details.meta.title, "metadata only"].filter(Boolean).join(" · "));
	}
}

/** Pi builds the result of a call that threw (an abort, rejected arguments, a bug) with empty details: its message is the content. */
function failureText(error: WebError | undefined, result: Rendered<unknown>): string {
	return error ? describe(error) : textOf(result);
}

function callLine(label: string, target: string, options: string[], theme: Theme): string {
	const line = `${theme.fg("toolTitle", theme.bold(label))} ${theme.fg("accent", target)}`;
	return options.length > 0 ? `${line} ${theme.fg("muted", options.join(", "))}` : line;
}

function textOf(result: Rendered<unknown>): string {
	return result.content
		.filter((c) => c.type === "text" && typeof c.text === "string")
		.map((c) => c.text)
		.join("\n");
}

function size(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
