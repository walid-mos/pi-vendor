/**
 * Bytes and their content type to a string: the header's charset, else an HTML page's own <meta> declaration in its
 * first bytes, else UTF-8. Labels are WHATWG encoding labels, read by TextDecoder.
 */

import { WebToolError } from "./errors.ts";

/** How far into an HTML page its <meta> charset declaration is looked for, as browsers do (HTML's prescan). */
const META_PRESCAN_BYTES = 1024;

export function decodeText(bytes: Buffer, contentType: string): string {
	const label = headerCharset(contentType) ?? (isHtml(contentType) ? metaCharset(bytes) : undefined) ?? "utf-8";
	let decoder: TextDecoder;
	try {
		decoder = new TextDecoder(label);
	} catch (thrown) {
		if (thrown instanceof RangeError) throw new WebToolError({ kind: "unsupported_charset", charset: label }, { cause: thrown });
		throw thrown;
	}
	return decoder.decode(bytes);
}

function headerCharset(contentType: string): string | undefined {
	return /;\s*charset\s*=\s*"?([^";\s]+)"?/i.exec(contentType)?.[1];
}

function isHtml(contentType: string): boolean {
	return /^\s*(text\/html|application\/xhtml\+xml)\s*(;|$)/i.test(contentType) || contentType.trim() === "";
}

/** `<meta charset=…>` or `<meta http-equiv="Content-Type" content="…; charset=…">`. */
function metaCharset(bytes: Buffer): string | undefined {
	const head = bytes.subarray(0, META_PRESCAN_BYTES).toString("latin1");
	return /<meta\b[^>]*?charset\s*=\s*["']?([\w.:-]+)/i.exec(head)?.[1];
}
