/**
 * Bytes and their content type to a string: a byte order mark, else the header's charset, else an HTML page's own <meta>
 * declaration in its first bytes, else UTF-8. Labels are WHATWG encoding labels, read by TextDecoder.
 */

import { WebToolError } from "./errors.ts";

/** How far into an HTML page its <meta> charset declaration is looked for, as browsers do (HTML's prescan). */
const META_PRESCAN_BYTES = 1024;

export function decodeText(bytes: Buffer, contentType: string): string {
	const label = bomCharset(bytes) ?? headerCharset(contentType) ?? (isHtml(contentType) ? metaCharset(bytes) : undefined) ?? "utf-8";
	let decoder: TextDecoder;
	try {
		decoder = new TextDecoder(label);
	} catch (thrown) {
		if (thrown instanceof RangeError) throw new WebToolError({ kind: "unsupported_charset", charset: label }, { cause: thrown });
		throw thrown;
	}
	return decoder.decode(bytes);
}

/** A byte order mark outranks every declaration, as in the WHATWG "decode" algorithm. */
function bomCharset(bytes: Buffer): string | undefined {
	if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return "utf-8";
	if (bytes[0] === 0xff && bytes[1] === 0xfe) return "utf-16le";
	if (bytes[0] === 0xfe && bytes[1] === 0xff) return "utf-16be";
	return undefined;
}

function headerCharset(contentType: string): string | undefined {
	return /;\s*charset\s*=\s*"?([^";\s]+)"?/i.exec(contentType)?.[1];
}

function isHtml(contentType: string): boolean {
	return /^\s*(text\/html|application\/xhtml\+xml)\s*(;|$)/i.test(contentType) || contentType.trim() === "";
}

/**
 * `<meta charset=…>` or `<meta http-equiv="Content-Type" content="…; charset=…">`, among the tags that end inside the
 * prescan window and outside comments: a tag cut off by the window's end is not a declaration.
 */
function metaCharset(bytes: Buffer): string | undefined {
	const head = bytes.subarray(0, META_PRESCAN_BYTES).toString("latin1").replace(/<!--[\s\S]*?(?:-->|$)/g, "");
	for (const [tag] of head.matchAll(/<meta\s[^>]*>/gi)) {
		const attributes = new Map<string, string>();
		for (const [, name, double, single, bare] of tag.matchAll(/([^\s"'<>/=]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([\w.:-]+))/g)) {
			attributes.set(name.toLowerCase(), double ?? single ?? bare);
		}
		const isContentType = attributes.get("http-equiv")?.toLowerCase() === "content-type";
		const declared = attributes.get("charset") ?? (isContentType ? /charset\s*=\s*["']?([\w.:-]+)/i.exec(attributes.get("content") ?? "")?.[1] : undefined);
		if (declared) return declared;
	}
	return undefined;
}
