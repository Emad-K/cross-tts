import { defineConfig } from "@playwright/test";

/**
 * Electron E2E smoke tests. Run `pnpm run build` first — the spec launches the
 * built main bundle (out/main/index.js) with Electron, not the dev server.
 */
export default defineConfig({
	testDir: ".",
	testMatch: "**/*.spec.ts",
	// One Electron app at a time; the suite is a single smoke spec anyway.
	workers: 1,
	fullyParallel: false,
	timeout: 90_000,
	expect: { timeout: 15_000 },
	retries: process.env.CI ? 1 : 0,
	reporter: process.env.CI ? [["list"], ["github"]] : [["list"]],
	use: {
		trace: "retain-on-failure",
	},
});
