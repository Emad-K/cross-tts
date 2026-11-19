import { describe, expect, test } from "bun:test";
import {
	NATIVE_TTS_SERVICE_NAME,
	nativeSpawnDecision,
	shouldRecordChildGone,
} from "./nativeEngineGate";

describe("nativeSpawnDecision", () => {
	const hubBaseUrl = "http://127.0.0.1:1234";

	test("spawns when the binding and the hub are both there", () => {
		expect(nativeSpawnDecision({ bindingPresent: true, hubBaseUrl })).toEqual({
			ok: true,
		});
	});

	test("never spawns without the binding (Intel Mac)", () => {
		const decision = nativeSpawnDecision({ bindingPresent: false, hubBaseUrl });
		expect(decision.ok).toBe(false);
		// The missing binding wins over a missing hub: it can't be fixed by retrying.
		expect(nativeSpawnDecision({ bindingPresent: false, hubBaseUrl: null })).toEqual(
			decision,
		);
	});

	test("doesn't spawn without the local model hub", () => {
		expect(nativeSpawnDecision({ bindingPresent: true, hubBaseUrl: null })).toEqual({
			ok: false,
			error: "Local model hub isn't running",
		});
	});
});

describe("shouldRecordChildGone", () => {
	const native = { type: "Utility", serviceName: NATIVE_TTS_SERVICE_NAME };

	test("normal teardown is never a crash", () => {
		for (const reason of ["clean-exit", "killed"]) {
			expect(
				shouldRecordChildGone({ ...native, reason }, { nativeReady: true }),
			).toBe(false);
			expect(
				shouldRecordChildGone({ type: "GPU", reason }, { nativeReady: false }),
			).toBe(false);
		}
	});

	test("native TTS dying during init is expected, not a crash", () => {
		for (const reason of ["crashed", "abnormal-exit", "launch-failed", "oom"]) {
			expect(
				shouldRecordChildGone({ ...native, reason }, { nativeReady: false }),
			).toBe(false);
		}
	});

	test("native TTS crashing after it was ready is recorded", () => {
		expect(
			shouldRecordChildGone({ ...native, reason: "crashed" }, { nativeReady: true }),
		).toBe(true);
	});

	test("other child processes are recorded whatever the native state", () => {
		expect(
			shouldRecordChildGone({ type: "GPU", reason: "crashed" }, { nativeReady: false }),
		).toBe(true);
		expect(
			shouldRecordChildGone(
				{ type: "Utility", reason: "crashed", serviceName: "network.mojom.NetworkService" },
				{ nativeReady: false },
			),
		).toBe(true);
	});
});
