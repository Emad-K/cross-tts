import { describe, expect, test } from "bun:test";
import {
	coerceOutputDevice,
	listOutputDevices,
	resolveOutputSink,
} from "./outputDeviceChoice";

const speakers = { id: "aaa", label: "Speakers" };
const headset = { id: "bbb", label: "Headset" };

describe("listOutputDevices", () => {
	test("keeps real outputs only and names unlabeled ones", () => {
		expect(
			listOutputDevices([
				{ kind: "audioinput", deviceId: "mic", label: "Mic" },
				{ kind: "audiooutput", deviceId: "default", label: "Default" },
				{ kind: "audiooutput", deviceId: "communications", label: "Comms" },
				{ kind: "audiooutput", deviceId: "", label: "" },
				{ kind: "audiooutput", deviceId: "aaa", label: "Speakers" },
				{ kind: "audiooutput", deviceId: "ccc", label: "" },
			]),
		).toEqual([speakers, { id: "ccc", label: "Output 2" }]);
	});
});

describe("resolveOutputSink", () => {
	test("system default without a preference", () => {
		expect(resolveOutputSink(null, [speakers, headset])).toBe("");
	});

	test("the preferred device while it is connected", () => {
		expect(resolveOutputSink(headset, [speakers, headset])).toBe("bbb");
	});

	test("falls back to the system default when it is unplugged", () => {
		expect(resolveOutputSink(headset, [speakers])).toBe("");
		expect(resolveOutputSink(headset, [])).toBe("");
	});

	test("follows a device whose id changed but name didn't", () => {
		expect(resolveOutputSink(headset, [{ id: "zzz", label: "Headset" }])).toBe(
			"zzz",
		);
	});
});

describe("coerceOutputDevice", () => {
	test("accepts a saved device, rejects junk", () => {
		expect(coerceOutputDevice({ id: "bbb", label: "Headset", x: 1 })).toEqual(
			headset,
		);
		for (const junk of [null, "bbb", {}, { id: "", label: "x" }, { id: 3 }]) {
			expect(coerceOutputDevice(junk)).toBeNull();
		}
	});
});
