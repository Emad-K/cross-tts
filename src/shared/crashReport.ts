/**
 * Crash-report records and the GitHub issue link built from them.
 *
 * Privacy by construction: a record only ever contains the crash kind, error
 * name/message/stack, timestamps, and app/platform versions — never document
 * text or file paths the user opened. The username embedded in home-directory
 * paths inside stack traces is redacted to `<user>` (see {@link redactUserPaths}).
 * Nothing is sent anywhere automatically; the renderer shows the exact JSON to
 * the user, who may choose to open a prefilled GitHub issue with it.
 */

/** Where a crash was caught in the main process. */
export type CrashKind =
	| "uncaughtException"
	| "unhandledRejection"
	| "render-process-gone"
	| "child-process-gone";

export type CrashRecord = {
	/** Schema version of the record file. */
	v: 1;
	/** ISO timestamp of when the crash was captured. */
	timestamp: string;
	/** App version (package.json) at crash time. */
	appVersion: string;
	/** `process.platform` (+ arch), e.g. "linux x64". */
	platform: string;
	kind: CrashKind;
	/** Error class name, or a reason label for process-gone events. */
	name: string;
	message: string;
	/** Stack trace when available; home-dir paths have the username redacted. */
	stack: string | null;
};

/** Keep at most this many crash records on disk. */
export const MAX_STORED_CRASHES = 10;

/** Hard caps so a pathological error can't bloat records or the issue URL. */
const MAX_MESSAGE_CHARS = 1000;
const MAX_STACK_CHARS = 4000;

/** Prefilled GitHub issue URLs are capped to roughly this many characters. */
export const MAX_ISSUE_URL_CHARS = 6000;

export const CRASH_ISSUE_BASE_URL =
	"https://github.com/Emad-K/cross-tts/issues/new";

function truncate(s: string, max: number): string {
	return s.length <= max ? s : `${s.slice(0, max)}… [truncated]`;
}

/**
 * Strip the username out of home-directory paths that leak into stack traces
 * and error messages. The bundled code lives under the user's home, so Electron
 * stack frames embed absolute paths like `C:\Users\jane\AppData\…`. The first
 * segment under a known home root is replaced with `<user>`; everything after
 * (the app's own asar path) is kept — it's identical for every install and
 * useful for debugging.
 */
export function redactUserPaths(s: string): string {
	return (
		s
			// Windows: C:\Users\<name>\…  (also matches forward-slash variants)
			.replace(/([A-Za-z]:[\\/]Users[\\/])[^\\/]+/gi, "$1<user>")
			// macOS: /Users/<name>/…  and Linux: /home/<name>/…
			.replace(/(\/(?:Users|home)\/)[^/]+/g, "$1<user>")
	);
}

/**
 * Build a crash record from an arbitrary thrown value. Never throws: any
 * unexpected shape degrades to String(...) fields.
 */
export function buildCrashRecord(input: {
	kind: CrashKind;
	error: unknown;
	appVersion: string;
	platform: string;
	now?: Date;
}): CrashRecord {
	let name = "Error";
	let message = "";
	let stack: string | null = null;
	const { error } = input;
	if (error instanceof Error) {
		name = error.name || "Error";
		message = error.message;
		stack = typeof error.stack === "string" ? error.stack : null;
	} else {
		name = "NonError";
		try {
			message = typeof error === "string" ? error : JSON.stringify(error) ?? String(error);
		} catch {
			message = String(error);
		}
	}
	return {
		v: 1,
		timestamp: (input.now ?? new Date()).toISOString(),
		appVersion: input.appVersion,
		platform: input.platform,
		kind: input.kind,
		name,
		message: truncate(redactUserPaths(message), MAX_MESSAGE_CHARS),
		stack: stack === null ? null : truncate(redactUserPaths(stack), MAX_STACK_CHARS),
	};
}

/** Parse a stored record; null when the file content isn't a v1 crash record. */
export function parseCrashRecord(json: string): CrashRecord | null {
	try {
		const o = JSON.parse(json) as Record<string, unknown>;
		if (!o || typeof o !== "object" || o.v !== 1) return null;
		if (
			typeof o.timestamp !== "string" ||
			typeof o.appVersion !== "string" ||
			typeof o.platform !== "string" ||
			typeof o.kind !== "string" ||
			typeof o.name !== "string" ||
			typeof o.message !== "string"
		) {
			return null;
		}
		return {
			v: 1,
			timestamp: o.timestamp,
			appVersion: o.appVersion,
			platform: o.platform,
			kind: o.kind as CrashKind,
			name: o.name,
			message: o.message,
			stack: typeof o.stack === "string" ? o.stack : null,
		};
	} catch {
		return null;
	}
}

/** Exact JSON shown to the user (and written to disk). */
export function crashRecordToJson(record: CrashRecord): string {
	return JSON.stringify(record, null, "\t");
}

/** Markdown body for a prefilled GitHub issue (crash JSON in a code block). */
export function buildIssueBody(records: CrashRecord[]): string {
	const first = records[0];
	const header = first
		? `Cross TTS ${first.appVersion} crashed on ${first.platform}.`
		: "Cross TTS crashed.";
	const blocks = records.map(
		(r) => "```json\n" + crashRecordToJson(r) + "\n```",
	);
	return [
		header,
		"",
		"Crash report (captured locally, reviewed before sending):",
		"",
		...blocks,
		"",
		"<!-- Please describe what you were doing when it crashed. -->",
	].join("\n");
}

/**
 * Prefilled new-issue URL. Encoded length is capped at ~{@link MAX_ISSUE_URL_CHARS}
 * by dropping older records first, then trimming the body — browsers and GitHub
 * reject very long URLs.
 */
export function buildGitHubIssueUrl(records: CrashRecord[]): string {
	const first = records[0];
	const title = first
		? `Crash: ${first.name}: ${truncate(first.message, 80)} (v${first.appVersion})`
		: "Crash report";

	const assemble = (body: string) =>
		`${CRASH_ISSUE_BASE_URL}?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`;

	// Newest record first; drop the oldest while the URL is too long.
	for (let count = Math.max(1, records.length); count >= 1; count--) {
		const url = assemble(buildIssueBody(records.slice(0, count)));
		if (url.length <= MAX_ISSUE_URL_CHARS) return url;
	}

	// A single record is still too long — binary-trim its body text.
	const body = buildIssueBody(records.slice(0, 1));
	let lo = 0;
	let hi = body.length;
	while (lo < hi) {
		const mid = Math.ceil((lo + hi) / 2);
		if (assemble(`${body.slice(0, mid)}…`).length <= MAX_ISSUE_URL_CHARS) lo = mid;
		else hi = mid - 1;
	}
	return assemble(`${body.slice(0, lo)}…`);
}
