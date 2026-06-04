import type { LogLevel } from "@shared/logEntry";
import { useLogStore } from "./logStore";

type LogOpts = {
	source?: string;
	/** Pre-formatted detail line, or an Error/unknown to derive it from. */
	detail?: string;
	error?: unknown;
};

function detailFrom(opts?: LogOpts): string | undefined {
	if (opts?.detail) return opts.detail;
	const e = opts?.error;
	if (e === undefined) return undefined;
	return e instanceof Error ? e.message : String(e);
}

function emit(level: LogLevel, message: string, opts?: LogOpts): void {
	const detail = detailFrom(opts);
	useLogStore.getState().add({
		level,
		message,
		...(detail ? { detail } : {}),
		...(opts?.source ? { source: opts.source } : {}),
	});
	const line = `[${opts?.source ?? "app"}] ${message}${detail ? ` — ${detail}` : ""}`;
	if (level === "error") console.error(line);
	else if (level === "warn") console.warn(line);
	else console.info(line);
}

export function logInfo(message: string, opts?: LogOpts): void {
	emit("info", message, opts);
}

export function logWarn(message: string, opts?: LogOpts): void {
	emit("warn", message, opts);
}

export function logError(message: string, opts?: LogOpts): void {
	emit("error", message, opts);
}
