import { describe, expect, test } from "bun:test";
import {
	CRASH_ISSUE_BASE_URL,
	MAX_ISSUE_URL_CHARS,
	buildCrashRecord,
	buildGitHubIssueUrl,
	buildIssueBody,
	crashRecordToJson,
	parseCrashRecord,
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
