/**
 * The web package's entry point: the only file that imports Pi at run time. It builds the real dependencies and
 * registers the two tools from `createWebTools`, with their renderers wrapped in Pi's Text. No logic of its own.
 */

import { type ExtensionAPI, type ExtensionContext, resizeImage } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";

import { PRODUCTION } from "../src/http.ts";
import { renderFetchCall, renderFetchResult, renderSearchCall, renderSearchResult, type Theme } from "../src/render.ts";
import { createWebTools, FXTWITTER } from "../src/tools.ts";
import { OUTPUT_LIMITS } from "../src/truncate.ts";
import { PRODUCTION_MEDIA } from "../src/x/media.ts";

const PROVIDER = "magpie";

const [webSearch, fetchContent] = createWebTools({
	magpie: async (ctx: ExtensionContext) => ({
		baseUrl: ctx.modelRegistry.getProvider(PROVIDER)?.baseUrl,
		key: await ctx.modelRegistry.getApiKeyForProvider(PROVIDER),
	}),
	network: PRODUCTION,
	media: PRODUCTION_MEDIA,
	fxtwitter: FXTWITTER,
	resizeImage,
	outputLimits: OUTPUT_LIMITS,
});

/** The previous component of the slot, updated in place, or a new one. */
function text(content: string, context: { lastComponent?: unknown }): Text {
	const component = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
	component.setText(content);
	return component;
}

export default function (pi: ExtensionAPI) {
	pi.registerTool({
		...webSearch,
		renderCall: (args, theme, context) => text(renderSearchCall(args, theme as Theme), context),
		renderResult: (result, { expanded }, theme, context) => text(renderSearchResult(result as never, expanded, theme as Theme), context),
	} as never);
	pi.registerTool({
		...fetchContent,
		renderCall: (args, theme, context) => text(renderFetchCall(args, theme as Theme), context),
		renderResult: (result, { expanded }, theme, context) => text(renderFetchResult(result as never, expanded, theme as Theme), context),
	} as never);
}
