import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";
import { MODEL_REVISION, MODEL_SHA256 } from "../shared/modelAssets";

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

// One path segment: no leading dot (so no "..", no dotfiles), no separators.
const SEG = "[A-Za-z0-9_-][A-Za-z0-9._-]*";
const KOKORO_REPO = "onnx-community/Kokoro-82M-v1\\.0-ONNX";

/**
 * Map a local Kokoro hub request path (`/<token>/<repo>/resolve/<rev>/<file>`)
 * to the HuggingFace path it proxies (`/<repo>/resolve/<rev>/<file>`), or null
 * if the token is wrong or the path is anything but a model/config/voice file
 * of the Kokoro repo at the pinned MODEL_REVISION. ONNX files must also have a
 * known sha256 (MODEL_SHA256) so their download can be verified.
 */
export function hubRequestPath(pathname: string, token: string): string | null {
	let p: string;
	try {
		p = decodeURIComponent(pathname);
	} catch {
		return null;
	}
	const prefix = `/${token}/`;
	if (!token || !p.startsWith(prefix)) return null;
	const rest = p.slice(prefix.length);
	const re = new RegExp(
		`^${KOKORO_REPO}/resolve/${MODEL_REVISION}/((?:${SEG}/)*${SEG}\\.(json|onnx|bin))$`,
	);
	const m = re.exec(rest);
	if (!m) return null;
	if (m[2] === "onnx" && !MODEL_SHA256[m[1]!]) return null;
	return `/${rest}`;
}

// An audio file, or its in-progress `<name>.part` (renamed once complete).
const AUDIO_EXT = /\.(mp3|wav|m4b)(\.part)?$/i;

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
