import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";
import { HUB_REPOS, type HubRepo } from "../shared/modelAssets";

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

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const ALL_HUB_REPOS: readonly HubRepo[] = Object.values(HUB_REPOS).flat();

/**
 * Check `hfPath` (`/<repo>/resolve/<rev>/<file>`) against every allowlisted
 * entry it matches (engines may share a repo), so entry order never matters.
 * Null if none matches, or if a match needs a hash and no match provides one.
 */
function matchHubFile(
	hfPath: string,
	repos: readonly HubRepo[],
): { sha256: string | undefined } | null {
	let matched = false;
	let needsHash = false;
	let sha256: string | undefined;
	for (const repo of repos) {
		const pinned = `/${repo.repo}/resolve/${repo.revision}/`;
		const file = hfPath.startsWith(pinned) ? hfPath.slice(pinned.length) : "";
		const exact = Object.hasOwn(repo.sha256, file) ? repo.sha256[file] : undefined;
		if (exact) {
			// Pinned by hash: allowed whatever its extension.
			matched = true;
			sha256 ??= exact;
			continue;
		}
		const re = new RegExp(
			`^/${escapeRe(repo.repo)}/resolve/${escapeRe(repo.revision)}/((?:${SEG}/)*${SEG}\\.(${repo.extensions.map(escapeRe).join("|")}))$`,
		);
		const m = re.exec(hfPath);
		if (!m) continue;
		matched = true;
		needsHash ||= !repo.unhashedExtensions.includes(m[2]!);
		sha256 ??= repo.sha256[m[1]!];
	}
	if (!matched || (needsHash && !sha256)) return null;
	return { sha256 };
}

/**
 * Map a local hub request path (`/<token>/<repo>/resolve/<rev>/<file>`) to the
 * HuggingFace path it proxies (`/<repo>/resolve/<rev>/<file>`), or null if the
 * token is wrong or the path isn't an allowed file of an allowlisted repo at
 * its pinned revision (HUB_REPOS). Files outside the repo's
 * `unhashedExtensions` must also have a known sha256 so their download can be
 * verified.
 */
export function hubRequestPath(
	pathname: string,
	token: string,
	repos: readonly HubRepo[] = ALL_HUB_REPOS,
): string | null {
	let p: string;
	try {
		p = decodeURIComponent(pathname);
	} catch {
		return null;
	}
	const prefix = `/${token}/`;
	if (!token || !p.startsWith(prefix)) return null;
	const hfPath = `/${p.slice(prefix.length)}`;
	return matchHubFile(hfPath, repos) ? hfPath : null;
}

/** Expected sha256 of an allowlisted hub file (from hubRequestPath), if known. */
export function hubFileSha256(
	hfPath: string,
	repos: readonly HubRepo[] = ALL_HUB_REPOS,
): string | undefined {
	return matchHubFile(hfPath, repos)?.sha256;
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
