/**
 * Pure guards used by the main process to validate renderer-supplied URLs and
 * paths. Kept free of Electron imports so they can be unit tested with bun.
 */

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
