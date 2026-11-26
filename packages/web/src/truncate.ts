/**
 * Caps the text a tool returns to the model. Beyond the limits, the full text is saved to a 0600 file in a fresh
 * temporary directory, and the returned text says what it shows and where the rest is: a stated cut, never a silent one.
 */

import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Pi's own limits for a tool's output. */
export const OUTPUT_LIMITS = { maxBytes: 50 * 1024, maxLines: 2000 };

export type Limits = { maxBytes: number; maxLines: number };

export type Capped = { text: string; truncated: false } | { text: string; truncated: true; fullOutputPath: string };

export async function capText(text: string, limits: Limits): Promise<Capped> {
	const lines = text.split("\n");
	const totalBytes = Buffer.byteLength(text);
	if (lines.length <= limits.maxLines && totalBytes <= limits.maxBytes) return { text, truncated: false };

	const { text: kept, insideLine } = keep(lines, limits);
	const dir = await mkdtemp(join(tmpdir(), "pi-web-"));
	const fullOutputPath = join(dir, "full-output.txt");
	await writeFile(fullOutputPath, text, { mode: 0o600 });
	const shown = insideLine ? "the start of line 1" : `lines 1 to ${kept.split("\n").length}`;
	const note = `[Output truncated: ${shown} of ${lines.length} (${Buffer.byteLength(kept)} of ${totalBytes} bytes)] Full text: ${fullOutputPath}`;
	return { text: `${kept}\n\n${note}`, truncated: true, fullOutputPath };
}

/** Whole lines within both limits; when not even the first line fits, as much of it as fits, on a character boundary. */
function keep(lines: string[], limits: Limits): { text: string; insideLine: boolean } {
	let bytes = 0;
	let count = 0;
	for (const line of lines.slice(0, limits.maxLines)) {
		const size = Buffer.byteLength(line) + (count > 0 ? 1 : 0);
		if (bytes + size > limits.maxBytes) break;
		bytes += size;
		count++;
	}
	if (count > 0) return { text: lines.slice(0, count).join("\n"), insideLine: false };
	return { text: new TextDecoder().decode(Buffer.from(lines[0]).subarray(0, limits.maxBytes)).replace(/\uFFFD$/, ""), insideLine: true };
}
