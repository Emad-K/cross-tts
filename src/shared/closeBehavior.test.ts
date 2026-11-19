import { describe, expect, test } from "bun:test";
import { closeAction, trayTooltip } from "./closeBehavior";

describe("closeAction", () => {
	const on = { keepPlaying: true, trayShown: true, quitting: false };

	test("hides only when the setting is on and the tray is there", () => {
		expect(closeAction(on)).toBe("hide");
		expect(closeAction({ ...on, keepPlaying: false })).toBe("close");
	});

	test("never hides a window that couldn't be brought back", () => {
		expect(closeAction({ ...on, trayShown: false })).toBe("close");
	});

	test("quitting really closes", () => {
		expect(closeAction({ ...on, quitting: true })).toBe("close");
	});
});

describe("trayTooltip", () => {
	test("title, then sentence, whitespace collapsed", () => {
		expect(trayTooltip({ title: " Dune ", sentence: "A  beginning\nis." })).toBe(
			"Dune\nA beginning is.",
		);
	});

	test("falls back to the app name", () => {
		expect(trayTooltip({ title: "", sentence: " " })).toBe("Cross TTS");
	});

	test("stays within the Windows limit", () => {
		const tip = trayTooltip({ title: "T", sentence: "x".repeat(500) });
		expect(tip.length).toBe(127);
		expect(tip.endsWith("…")).toBe(true);
	});
});
