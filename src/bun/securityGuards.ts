import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";

/**
 * Pure guards used by the main process to validate renderer-supplied URLs and
 * paths. Kept free of Electron imports so they can be unit tested with bun.
 */

/** True if `path` is one of `roots` or lies underneath one. */
export function isInsideRoot(path: string, roots: Iterable<string>): boolean {
	if (typeof path !== "string" || path === "" || path.includes("\0")) return false;
	const abs = resolve(path);
	for (const root of roots) {
		const r = relative(resolve(root), abs);
		if (r === "") return true;
		if (r !== ".." && !r.startsWith(`..${sep}`) && !isAbsolute(r)) return true;
	}
	return false;
}

const AUDIO_EXT = /\.(mp3|wav|m4b)$/i;

/**
 * Absolute target for an audiobook export write, or null if the renderer asked
 * for something outside the export folders the user picked, a name with path
 * separators, or a non-audio file type.
 */
export function audioExportPath(
	dir: unknown,
	fileName: unknown,
	roots: Iterable<string>,
): string | null {
	if (typeof dir !== "string" || typeof fileName !== "string") return null;
	if (!isInsideRoot(dir, roots)) return null;
	if (fileName.includes("\0") || basename(fileName) !== fileName) return null;
	if (fileName.includes("/") || fileName.includes("\\")) return null;
	if (!AUDIO_EXT.test(fileName)) return null;
	return join(resolve(dir), fileName);
}

/**
 * `scheme://host[:port]` of a URL, or null if unparsable. Node's URL returns
 * "null" for `.origin` on custom schemes like app://, so build it by hand.
 */
export function urlOrigin(url: string): string | null {
	try {
		const u = new URL(url);
		return u.host ? `${u.protocol}//${u.host}` : null;
	} catch {
		return null;
	}
}

/** True if `url` belongs to one of the `allowed` origins (`scheme://host`). */
export function isAllowedOrigin(url: string, allowed: readonly string[]): boolean {
	const o = urlOrigin(url);
	return o !== null && allowed.includes(o);
}
