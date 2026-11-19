import { expect, test } from "bun:test";
import { formatListened } from "./formatListened";

test("formatListened", () => {
	expect(formatListened(0)).toBe("under a minute");
	expect(formatListened(59.9)).toBe("under a minute");
	expect(formatListened(60)).toBe("1 m");
	expect(formatListened(45 * 60 + 30)).toBe("45 m");
	expect(formatListened(3600)).toBe("1 h");
	expect(formatListened(2 * 3600 + 10 * 60 + 59)).toBe("2 h 10 m");
});
