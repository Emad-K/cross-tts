import {
	mkdirSync,
	readFileSync,
	readdirSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { app, shell, type BrowserWindow } from "electron";
import {
	MAX_STORED_CRASHES,
	buildCrashRecord,
	buildGitHubIssueUrl,
	crashRecordToJson,
	parseCrashRecord,
	type CrashKind,
	type CrashRecord,
} from "../shared/crashReport";
import { crashPromptDisabled, dataDir, setCrashPromptDisabled } from "./appConfigStore";

const CRASHES_SUBDIR = "crashes";

function crashesDir(): string {
	return join(dataDir(), CRASHES_SUBDIR);
}

let crashSeq = 0;

/**
 * Persist one crash record to `<dataDir>/crashes/`. Must never throw — a
 * failing crash handler would turn one crash into two.
 */
function writeCrashRecord(kind: CrashKind, error: unknown): void {
	try {
		const record = buildCrashRecord({
			kind,
			error,
			appVersion: app.getVersion(),
			platform: `${process.platform} ${process.arch}`,
		});
		const dir = crashesDir();
		mkdirSync(dir, { recursive: true });
		// Timestamp + counter keeps names unique within one process lifetime.
		const name = `crash-${Date.now()}-${crashSeq++}.json`;
		writeFileSync(join(dir, name), crashRecordToJson(record));
		pruneOldCrashes(dir);
	} catch {
		// Swallow everything: never crash the crash handler.
	}
}

/** Keep at most MAX_STORED_CRASHES files (oldest deleted first). */
function pruneOldCrashes(dir: string): void {
	try {
		const files = readdirSync(dir)
			.filter((f) => f.endsWith(".json"))
			.sort();
		for (const f of files.slice(0, Math.max(0, files.length - MAX_STORED_CRASHES))) {
			try {
				unlinkSync(join(dir, f));
			} catch {
				// Ignore unremovable files.
			}
		}
	} catch {
		// Ignore.
	}
}

/** Crash record files currently on disk, oldest first. */
function listCrashFiles(): string[] {
	try {
		return readdirSync(crashesDir())
			.filter((f) => f.endsWith(".json"))
			.sort()
			.map((f) => join(crashesDir(), f));
	} catch {
		return [];
	}
}

/**
 * Unreported crashes from previous runs, newest first. Empty when the user
 * chose "Don't ask again" — records are still written, just never surfaced.
 */
export function pendingCrashReports(): CrashRecord[] {
	if (crashPromptDisabled()) return [];
	const records: CrashRecord[] = [];
	for (const path of listCrashFiles()) {
		try {
			const record = parseCrashRecord(readFileSync(path, "utf8"));
			if (record) records.push(record);
		} catch {
			// Unreadable file — skip it.
		}
	}
	return records.reverse();
}

/** Delete stored crash records (they were reported or dismissed). */
function markCrashesHandled(): void {
	for (const path of listCrashFiles()) {
		try {
			unlinkSync(path);
		} catch {
			// Ignore; pruning caps growth anyway.
		}
	}
}

/**
 * Renderer's decision on the post-crash dialog. "report" opens a prefilled
 * GitHub issue in the browser (the user saw the exact JSON beforehand);
 * nothing is ever sent automatically.
 */
export function resolveCrashReports(params: {
	action: "report" | "dismiss";
	dontAskAgain: boolean;
}): void {
	if (params.action === "report") {
		const records = pendingCrashReports();
		if (records.length > 0) {
			void shell.openExternal(buildGitHubIssueUrl(records));
		}
	}
	markCrashesHandled();
	if (params.dontAskAgain) setCrashPromptDisabled(true);
}

let captureInstalled = false;

/**
 * Install last-resort crash capture for the main process and its children.
 * Records are written to disk only; the user is asked on the *next* launch.
 */
export function initCrashCapture(): void {
	if (captureInstalled) return;
	captureInstalled = true;

	process.on("uncaughtException", (error) => {
		writeCrashRecord("uncaughtException", error);
		// Re-throwing would loop; log and let Electron's default behavior follow.
		console.error("Uncaught exception:", error);
	});
	process.on("unhandledRejection", (reason) => {
		writeCrashRecord("unhandledRejection", reason);
		console.error("Unhandled rejection:", reason);
	});
	app.on("render-process-gone", (_event, _webContents, details) => {
		// "clean-exit" / "killed" are normal teardown, not crashes.
		if (details.reason === "clean-exit" || details.reason === "killed") return;
		writeCrashRecord(
			"render-process-gone",
			new Error(`Renderer gone: ${details.reason} (exit code ${details.exitCode})`),
		);
	});
	app.on("child-process-gone", (_event, details) => {
		if (details.reason === "clean-exit" || details.reason === "killed") return;
		writeCrashRecord(
			"child-process-gone",
			new Error(
				`Child process gone: ${details.type} ${details.reason} (exit code ${details.exitCode})`,
			),
		);
	});
}

/**
 * Push unreported crashes from previous runs to the renderer once it loads
 * (same pattern as `app:update-status`). The renderer also pulls via the
 * `getPendingCrashReports` RPC in case it mounts after this fires.
 */
export function notifyCrashReportsOnLoad(win: BrowserWindow): void {
	const records = pendingCrashReports();
	if (records.length === 0) return;
	win.webContents.on("did-finish-load", () => {
		try {
			win.webContents.send("app:crash-reports", records);
		} catch {
			// Window may be tearing down; the renderer pulls on mount anyway.
		}
	});
}
