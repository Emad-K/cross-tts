// Launch electron-vite (`dev`/`preview`), transparently working around the
// broken Chromium sandbox on locked-down Linux desktops.
//
// Ubuntu 24.04+/26.04 ship `kernel.apparmor_restrict_unprivileged_userns=1`,
// which disables Chromium's user-namespace sandbox. Chromium then falls back to
// its setuid helper (`chrome-sandbox`), which only works when that file is
// root-owned with mode 4755 — true for a `.deb`/`.rpm` install, but NOT for a
// source checkout. In that state Electron aborts during native startup, before
// any of our main-process JS runs, with:
//
//   FATAL:setuid_sandbox_host.cc] The SUID sandbox helper binary ... is not
//   configured correctly. Rather than run without sandboxing I'm aborting now.
//
// Because that abort happens pre-JS, `app.commandLine.appendSwitch` can't fix
// it — the switch has to be set before the process spawns. electron-vite passes
// `--no-sandbox` through when `NO_SANDBOX=1` is in the environment, so we set it
// here, but ONLY when the sandbox truly can't work. Where it can (deb/rpm
// installs, older distros, a correctly-setuid helper, non-Linux), we leave the
// sandbox on.

import { spawn } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);

function readSysctl(path) {
	try {
		return readFileSync(path, "utf8").trim();
	} catch {
		return null;
	}
}

function userNamespacesRestricted() {
	// Ubuntu 24.04+ AppArmor knob: 1 = unprivileged userns blocked.
	if (readSysctl("/proc/sys/kernel/apparmor_restrict_unprivileged_userns") === "1")
		return true;
	// Debian-style switch: 0 = unprivileged userns disabled entirely.
	if (readSysctl("/proc/sys/kernel/unprivileged_userns_clone") === "0")
		return true;
	return false;
}

function suidSandboxUsable() {
	let electronBinary;
	try {
		electronBinary = require("electron");
	} catch {
		return false;
	}
	if (typeof electronBinary !== "string") return false;
	const sandbox = join(dirname(electronBinary), "chrome-sandbox");
	try {
		const s = statSync(sandbox);
		return (s.mode & 0o4000) !== 0 && s.uid === 0; // setuid + owned by root
	} catch {
		return false;
	}
}

function sandboxBroken() {
	return (
		process.platform === "linux" &&
		userNamespacesRestricted() &&
		!suidSandboxUsable()
	);
}

const mode = process.argv[2] || "dev";
const env = { ...process.env };

if (sandboxBroken()) {
	env.NO_SANDBOX = "1";
	console.log(
		"[run-electron-vite] Chromium sandbox can't run here (unprivileged user " +
			"namespaces are restricted and chrome-sandbox isn't setuid-root); " +
			"launching with --no-sandbox. Install the .deb/.rpm to keep the sandbox on.",
	);
}

// Resolve electron-vite's CLI from node_modules and run it with the same Node.
// Its `exports` map hides the bin subpath, so locate it via the package root
// (main entry is <pkg>/dist/index.*).
const eviteMain = require.resolve("electron-vite");
const cli = join(dirname(dirname(eviteMain)), "bin", "electron-vite.js");
if (!existsSync(cli)) {
	console.error(`[run-electron-vite] electron-vite CLI not found at ${cli}`);
	process.exit(1);
}
const child = spawn(process.execPath, [cli, mode, ...process.argv.slice(3)], {
	stdio: "inherit",
	env,
});
child.on("close", (code) => process.exit(code ?? 0));
child.on("error", (err) => {
	console.error("[run-electron-vite]", err);
	process.exit(1);
});
