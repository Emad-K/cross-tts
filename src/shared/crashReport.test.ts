import { describe, expect, test } from "bun:test";
import {
	CRASH_ISSUE_BASE_URL,
	MAX_ISSUE_URL_CHARS,
	buildCrashRecord,
	buildGitHubIssueUrl,
	buildIssueBody,
	crashRecordToJson,
	parseCrashRecord,
	redactUserPaths,
	type CrashRecord,
} from "./crashReport";

const NOW = new Date("2026-06-10T12:00:00.000Z");

function record(overrides: Partial<CrashRecord> = {}): CrashRecord {
	return {
		v: 1,
		timestamp: NOW.toISOString(),
		appVersion: "1.9.18",
		platform: "linux x64",
		kind: "uncaughtException",
		name: "TypeError",
		message: "boom",
		stack: "TypeError: boom\n    at main (index.js:1:1)",
		...overrides,
	};
}

describe("buildCrashRecord", () => {
	test("captures name/message/stack from an Error", () => {
		const err = new TypeError("cannot read x");
		const r = buildCrashRecord({
			kind: "uncaughtException",
			error: err,
			appVersion: "1.9.18",
			platform: "linux x64",
			now: NOW,
		});
		expect(r).toMatchObject({
			v: 1,
			timestamp: "2026-06-10T12:00:00.000Z",
			appVersion: "1.9.18",
			platform: "linux x64",
			kind: "uncaughtException",
			name: "TypeError",
			message: "cannot read x",
		});
		expect(r.stack).toContain("TypeError: cannot read x");
	});

	test("handles non-Error throwables without crashing", () => {
		const r = buildCrashRecord({
			kind: "unhandledRejection",
			error: { code: 42 },
			appVersion: "1.9.18",
			platform: "win32 x64",
			now: NOW,
		});
		expect(r.name).toBe("NonError");
		expect(r.message).toBe('{"code":42}');
		expect(r.stack).toBeNull();
	});

	test("handles values JSON.stringify rejects (circular)", () => {
		const cyc: Record<string, unknown> = {};
		cyc.self = cyc;
		const r = buildCrashRecord({
			kind: "unhandledRejection",
			error: cyc,
			appVersion: "1.9.18",
			platform: "linux x64",
			now: NOW,
		});
		expect(r.message).toBe("[object Object]");
	});

	test("redacts the username from home-dir paths in stack and message", () => {
		const err = new Error(
			"Renderer gone at C:\\Users\\emad\\AppData\\Local\\Programs\\Cross TTS\\resources\\app.asar\\out\\main\\index.js",
		);
		err.stack =
			"Error: boom\n    at App.<anonymous> (C:\\Users\\emad\\AppData\\Local\\Programs\\Cross TTS\\resources\\app.asar\\out\\main\\index.js:2186:7)";
		const r = buildCrashRecord({
			kind: "render-process-gone",
			error: err,
			appVersion: "1.12.0",
			platform: "win32 x64",
			now: NOW,
		});
		expect(r.message).not.toContain("emad");
		expect(r.message).toContain("C:\\Users\\<user>\\AppData");
		expect(r.stack ?? "").not.toContain("emad");
		expect(r.stack ?? "").toContain("C:\\Users\\<user>\\AppData");
		// Keeps the app-relative path after the home root for debugging.
		expect(r.stack ?? "").toContain("app.asar\\out\\main\\index.js");
	});

	test("truncates oversized message and stack", () => {
		const err = new Error("m".repeat(5000));
		err.stack = "s".repeat(20_000);
		const r = buildCrashRecord({
			kind: "uncaughtException",
			error: err,
			appVersion: "1.9.18",
			platform: "linux x64",
			now: NOW,
		});
		expect(r.message.length).toBeLessThan(1100);
		expect(r.message.endsWith("… [truncated]")).toBe(true);
		expect((r.stack ?? "").length).toBeLessThan(4100);
	});
});

describe("redactUserPaths", () => {
	test("redacts Windows, macOS, and Linux home paths", () => {
		expect(redactUserPaths("C:\\Users\\emad\\AppData\\x")).toBe(
			"C:\\Users\\<user>\\AppData\\x",
		);
		expect(redactUserPaths("D:/Users/Jane Doe/app")).toBe("D:/Users/<user>/app");
		expect(redactUserPaths("/Users/emad/Library/x")).toBe("/Users/<user>/Library/x");
		expect(redactUserPaths("/home/emad/.config/x")).toBe("/home/<user>/.config/x");
	});

	test("leaves paths without a home root untouched", () => {
		expect(redactUserPaths("at main (index.js:1:1)")).toBe("at main (index.js:1:1)");
		expect(redactUserPaths("/var/log/app/out.js")).toBe("/var/log/app/out.js");
	});
});

describe("crashRecordToJson / parseCrashRecord", () => {
	test("round-trips a record exactly", () => {
		const r = record();
		expect(parseCrashRecord(crashRecordToJson(r))).toEqual(r);
	});

	test("rejects malformed and foreign JSON", () => {
		expect(parseCrashRecord("not json")).toBeNull();
		expect(parseCrashRecord("{}")).toBeNull();
		expect(parseCrashRecord('{"v":2}')).toBeNull();
		expect(parseCrashRecord('{"v":1,"timestamp":3}')).toBeNull();
	});

	test("record contains only the expected keys (no user content fields)", () => {
		expect(Object.keys(record()).sort()).toEqual([
			"appVersion",
			"kind",
			"message",
			"name",
			"platform",
			"stack",
			"timestamp",
			"v",
		]);
	});
});

describe("buildGitHubIssueUrl", () => {
	test("targets the repo's new-issue page with encoded title and body", () => {
		const url = buildGitHubIssueUrl([
			record({ name: "RangeError", message: "out of bounds & more" }),
		]);
		expect(url.startsWith(`${CRASH_ISSUE_BASE_URL}?title=`)).toBe(true);
		const parsed = new URL(url);
		const title = parsed.searchParams.get("title") ?? "";
		const body = parsed.searchParams.get("body") ?? "";
		expect(title).toContain("RangeError: out of bounds & more");
		expect(title).toContain("v1.9.18");
		// Raw specials must be percent-encoded in the URL itself.
		expect(url).not.toContain(" ");
		expect(url).not.toContain("\n");
		expect(body).toContain("```json");
		expect(body).toContain('"kind": "uncaughtException"');
		expect(body).toContain("linux x64");
	});

	test("body embeds the exact crash JSON shown to the user", () => {
		const r = record();
		const body = buildIssueBody([r]);
		expect(body).toContain(crashRecordToJson(r));
	});

	test("caps URL length by dropping older records", () => {
		const records = Array.from({ length: 10 }, (_, i) =>
			record({ message: `crash ${i}`, stack: "x".repeat(3000) }),
		);
		const url = buildGitHubIssueUrl(records);
		expect(url.length).toBeLessThanOrEqual(MAX_ISSUE_URL_CHARS);
		// Newest record always survives.
		expect(decodeURIComponent(url)).toContain("crash 0");
	});

	test("caps URL length even for a single huge record", () => {
		const url = buildGitHubIssueUrl([
			record({ stack: "y".repeat(4000), message: "z".repeat(1000) }),
		]);
		expect(url.length).toBeLessThanOrEqual(MAX_ISSUE_URL_CHARS);
	});

	test("handles an empty record list", () => {
		const url = buildGitHubIssueUrl([]);
		expect(url.startsWith(CRASH_ISSUE_BASE_URL)).toBe(true);
		expect(url.length).toBeLessThanOrEqual(MAX_ISSUE_URL_CHARS);
	});
});
