/**
 * decide — a Pi tool that answers a closed question with Jev (System One) through the Magpie gateway.
 *
 * The agent settles a choice, a yes/no check or a rating without spending an LLM turn: picking a tool,
 * sorting items, or a guard before a destructive action. Jev is asked at `group/decide`.
 *
 * Uses the `magpie` provider configured in Pi (models.json for the address, auth.json for the key): the
 * address and key come from Pi's model registry. No other network call, no file read or written, no dependency.
 */

import { StringEnum, Type } from "@earendil-works/pi-ai";
import { defineTool, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";

const TIMEOUT_MS = 10_000;

type Answer = {
	type: string;
	choice?: string;
	score?: number;
	noul?: number;
	confidence?: number;
	probabilities?: Record<string, number>;
};

const PROVIDER = "magpie";

/** Address and key of the `magpie` provider, as Pi resolves them (models.json + auth.json). */
async function gateway(ctx: ExtensionContext): Promise<{ url: string; key: string }> {
	const model = ctx.modelRegistry.getAll().find((m) => m.provider === PROVIDER);
	const resolved = await ctx.modelRegistry.getProviderAuth(PROVIDER);
	const base = (resolved?.auth.baseUrl ?? model?.baseUrl)?.replace(/\/+$/, "");
	const key = resolved?.auth.apiKey;
	if (!base || !key) throw new Error(`decide needs the "${PROVIDER}" provider: its models in models.json and its key in auth.json`);
	return { url: `${base.endsWith("/v1") ? base : `${base}/v1`}/systemone`, key };
}

const decideTool = defineTool({
	name: "decide",
	label: "Decide",
	description:
		"Answer one closed question about a given state with Jev, a fast decision model (no text generation). " +
		"kind=choice picks one of `options`; kind=noul gives the probability (0 to 1) that the yes/no `question` is true; " +
		"kind=score rates on ordered `options` levels, lowest first, and returns a position from 0 to n-1. " +
		"Returns the answer with its confidence and probabilities. Ask one sharp judgement per call; keep arithmetic, counting and date comparisons in code.",
	promptSnippet: "Settle a closed question (choice, yes/no, rating) with the Jev decision model",
	promptGuidelines: [
		"Use decide for a closed judgement on text you already have (which option fits, is this destructive, how severe) instead of reasoning it out at length.",
		"Treat decide answers as signals: act on a choice only when its confidence is at least 0.4; read a noul of 0.7 or more as yes, 0.3 or less as no, and ask the user in between.",
		"Before a destructive or irreversible action, call decide with kind=noul and ask whether the action destroys or irreversibly changes data; if the answer is not clearly no, confirm with the user.",
		"Do not use decide for arithmetic, counting, comparing dates or generating text.",
	],
	parameters: Type.Object({
		kind: StringEnum(["choice", "noul", "score"] as const, { description: "Question type" }),
		state: Type.String({ description: "The content to judge: a message, a snippet, a record (plain text or JSON)" }),
		question: Type.String({ description: "One sharp question about the state" }),
		options: Type.Optional(
			Type.Array(Type.String(), {
				description: "choice: the options (2 to 255); score: the levels, lowest first (2 to 10). Not used for noul.",
			}),
		),
	}),

	async execute(_toolCallId, params, signal, _onUpdate, ctx) {
		const { url, key } = await gateway(ctx);
		const opts = params.options ?? [];
		let q: Record<string, unknown>;
		if (params.kind === "noul") {
			q = { type: "noul", instructions: params.question };
		} else if (params.kind === "choice") {
			if (opts.length < 2 || opts.length > 255) throw new Error("choice needs 2 to 255 options");
			q = { type: "choice", instructions: params.question, criteria: Object.fromEntries(opts.map((o) => [o, null])) };
		} else {
			if (opts.length < 2 || opts.length > 10) throw new Error("score needs 2 to 10 levels, lowest first");
			q = { type: "score", instructions: params.question, criteria: opts };
		}
		let state: unknown = params.state;
		try {
			const parsed = JSON.parse(params.state);
			if (parsed && typeof parsed === "object") state = parsed;
		} catch {
			// plain text state
		}
		const timeout = AbortSignal.timeout(TIMEOUT_MS);
		const res = await fetch(url, {
			method: "POST",
			headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "User-Agent": "pi-decide/0.1" },
			body: JSON.stringify({ model: "group/decide", state, questions: { q } }),
			signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
		});
		const text = await res.text();
		if (!res.ok) throw new Error(`decide: HTTP ${res.status} ${text.slice(0, 300)}`);
		const body = JSON.parse(text) as { model?: string; answers?: { q?: Answer } };
		const a = body.answers?.q;
		if (!a) throw new Error("decide: no answer in the reply");
		const answer = a.choice ?? a.score ?? a.noul;
		const confidence = a.confidence ?? (a.noul !== undefined ? Math.abs(2 * a.noul - 1) : undefined);
		const out = { answer, confidence, probabilities: a.probabilities ?? null, model: body.model };
		return { content: [{ type: "text", text: JSON.stringify(out) }], details: out };
	},
});

export default function (pi: ExtensionAPI) {
	pi.registerTool(decideTool);
}
