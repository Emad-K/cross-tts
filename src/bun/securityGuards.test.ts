import { describe, expect, test } from "bun:test";
import { isAllowedOrigin } from "./securityGuards";

describe("isAllowedOrigin", () => {
	const allowed = ["app://bundle", "http://localhost:5173"];
	test("accepts app and dev origins", () => {
		expect(isAllowedOrigin("app://bundle/index.html#x", allowed)).toBe(true);
		expect(isAllowedOrigin("http://localhost:5173/", allowed)).toBe(true);
	});
	test("rejects everything else", () => {
		expect(isAllowedOrigin("https://evil.example/", allowed)).toBe(false);
		expect(isAllowedOrigin("app://evil/index.html", allowed)).toBe(false);
		expect(isAllowedOrigin("http://localhost:5174/", allowed)).toBe(false);
		expect(isAllowedOrigin("file:///etc/passwd", allowed)).toBe(false);
		expect(isAllowedOrigin("not a url", allowed)).toBe(false);
	});
});
