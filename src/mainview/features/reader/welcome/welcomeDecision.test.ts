import { expect, test } from "bun:test";
import { shouldShowWelcome } from "./welcomeDecision";

const fresh = {
	welcomeSeen: false,
	modelsDownloaded: false,
	libraryCount: 0,
	hasOpenDocument: false,
};

test("a new install sees the welcome", () => {
	expect(shouldShowWelcome(fresh)).toBe(true);
});

test("it shows only once", () => {
	expect(shouldShowWelcome({ ...fresh, welcomeSeen: true })).toBe(false);
});

test("someone upgrading does not see it", () => {
	expect(shouldShowWelcome({ ...fresh, modelsDownloaded: true })).toBe(false);
	expect(shouldShowWelcome({ ...fresh, libraryCount: 3 })).toBe(false);
	expect(shouldShowWelcome({ ...fresh, hasOpenDocument: true })).toBe(false);
});
