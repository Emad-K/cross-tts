// Postinstall guard: make sure Electron's binary actually got unpacked.
//
// Electron's own postinstall downloads its prebuilt zip and unpacks it with
// `extract-zip` (yauzl 2.x). On Node 24 that extractor silently stops after the
// first file — `dist/` ends up with only `locales/`, no `electron` binary — and
// then `pnpm dev`/`build`/`start` can't launch Electron at all. CI runs Node 22,
// where it works, so this only bites contributors on Node 23+. The zip is still
// in Electron's cache after the failed unpack, so here we detect the missing
// binary and re-extract it with the system `unzip` (or bsdtar) instead.
//
// On a healthy install (Node 22, or a platform where the extractor works) the
// binary is already present and this is a no-op.

import { spawnSync } from "node:child_process";
import {
	chmodSync,
	existsSync,
	readdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);

function log(msg) {
	console.log(`[ensure-electron] ${msg}`);
}

// Where this platform's executable lives inside `dist/`, and what `path.txt`
// (read by the `electron` module to locate it) should contain.
function platformLayout() {
	if (process.platform === "win32") {
		return { rel: "electron.exe", pathTxt: "electron.exe" };
	}
	if (process.platform === "darwin") {
		const rel = "Electron.app/Contents/MacOS/Electron";
		return { rel, pathTxt: rel };
	}
	return { rel: "electron", pathTxt: "electron" };
}

function electronPkgDir() {
	// Resolve the installed `electron` package directory (works under pnpm's
	// symlinked layout). `require.resolve` lands on its main file.
	const mainFile = require.resolve("electron");
	return dirname(mainFile);
}

function cacheDirs(version) {
	const env = process.env;
	const explicit = env.electron_config_cache || env.ELECTRON_CACHE;
	const dirs = [];
	if (explicit) dirs.push(explicit);
	if (process.platform === "win32") {
		const base = env.LOCALAPPDATA || join(homedir(), "AppData", "Local");
		dirs.push(join(base, "electron", "Cache"));
	} else if (process.platform === "darwin") {
		dirs.push(join(homedir(), "Library", "Caches", "electron"));
	} else {
		const xdg = env.XDG_CACHE_HOME || join(homedir(), ".cache");
		dirs.push(join(xdg, "electron"));
	}
	return dirs;
}

function findCachedZip(version) {
	const name = `electron-v${version}-${process.platform}-${process.arch}.zip`;
	for (const dir of cacheDirs(version)) {
		if (!existsSync(dir)) continue;
		// Cache layout is <dir>/<sha>/<name>.
		for (const entry of readdirSync(dir)) {
			const candidate = join(dir, entry, name);
			if (existsSync(candidate)) return candidate;
		}
	}
	return null;
}

function tryExtract(zip, dest) {
	const attempts = [
		["unzip", ["-o", "-q", zip, "-d", dest]],
		// bsdtar (macOS / modern Windows) understands zip; GNU tar does not.
		["tar", ["-xf", zip, "-C", dest]],
	];
	for (const [cmd, args] of attempts) {
		const r = spawnSync(cmd, args, { stdio: "ignore" });
		if (r.status === 0) return cmd;
	}
	return null;
}

function main() {
	const pkgDir = electronPkgDir();
	const distDir = join(pkgDir, "dist");
	const { rel, pathTxt } = platformLayout();
	const binary = join(distDir, rel);

	if (existsSync(binary)) return; // Healthy install — nothing to do.

	const major = Number(process.versions.node.split(".")[0]);
	log(
		`Electron binary missing at ${binary} ` +
			`(Node ${process.versions.node}; the bundled zip extractor is known to ` +
			`fail on Node 23+). Repairing…`,
	);

	const version = JSON.parse(
		readFileSync(join(pkgDir, "package.json"), "utf8"),
	).version;

	const zip = findCachedZip(version);
	if (!zip) {
		log(
			`Could not find Electron's cached download for v${version}. ` +
				`Run \`pnpm rebuild electron\` once to fetch it, then reinstall. ` +
				`(Or use Node 22: \`fnm use 22\` / \`nvm use 22\`.)`,
		);
		process.exitCode = 1;
		return;
	}

	const used = tryExtract(zip, distDir);
	if (!used) {
		log(
			`Found the cached zip but no working unzip tool. Install \`unzip\` ` +
				`(\`sudo apt-get install -y unzip\`) and reinstall, or use Node 22.`,
		);
		process.exitCode = 1;
		return;
	}

	if (!existsSync(binary)) {
		log(`Extraction with ${used} did not produce ${binary}.`);
		process.exitCode = 1;
		return;
	}

	// Match what Electron's installer would have written.
	writeFileSync(join(pkgDir, "path.txt"), pathTxt);
	try {
		chmodSync(binary, 0o755);
		const sandbox = join(distDir, "chrome-sandbox");
		if (existsSync(sandbox)) chmodSync(sandbox, 0o755);
	} catch {
		// Permissions are best-effort; the binary path is what matters.
	}
	log(`Repaired Electron binary with ${used}.`);
}

main();
