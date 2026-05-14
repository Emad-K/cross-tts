import { existsSync, mkdirSync, readFileSync, renameSync, statSync } from "node:fs";
import { join, normalize, relative, resolve } from "node:path";
import { Utils } from "electrobun/bun";

const HF_ORIGIN = "https://huggingface.co";

type HubServer = ReturnType<typeof Bun.serve>;

let hub: HubServer | null = null;
export const hubCacheDirectory = () => join(Utils.paths.userData, "kokoro-hf-hub");
const inFlight = new Map<string, Promise<void>>();

function safeHubFile(urlPathname: string): string | null {
	const raw = decodeURIComponent(urlPathname).replace(/^\/+/, "");
	if (!raw || raw.includes("..")) return null;
	const abs = resolve(normalize(join(hubCacheDirectory(), ...raw.split("/"))));
	const root = resolve(hubCacheDirectory());
	const rel = relative(root, abs);
	if (rel.startsWith("..") || rel === "..") return null;
	return abs;
}

function looksLikeGitLfsPointer(filePath: string): boolean {
	try {
		const st = statSync(filePath);
		if (st.size > 512) return false;
		const head = readFileSync(filePath, "utf8").slice(0, 80);
		return head.includes("git-lfs.github.com/spec");
	} catch {
		return false;
	}
}

function isUsableCachedFile(filePath: string): boolean {
	if (!existsSync(filePath)) return false;
	const st = statSync(filePath);
	if (st.size === 0) return false;
	if (looksLikeGitLfsPointer(filePath)) return false;
	if (filePath.endsWith(".onnx") && st.size < 50_000) return false;
	if (filePath.endsWith(".bin") && st.size < 1_000) return false;
	return true;
}

async function ensureOnDisk(hfPath: string, dest: string): Promise<void> {
	if (isUsableCachedFile(dest)) return;

	const existing = inFlight.get(dest);
	if (existing) {
		await existing;
		return;
	}

	const task = (async () => {
		mkdirSync(join(dest, ".."), { recursive: true });
		const url = `${HF_ORIGIN}${hfPath}`;
		const res = await fetch(url, { redirect: "follow" });
		if (!res.ok) {
			throw new Error(`Kokoro hub fetch failed ${res.status}: ${url}`);
		}
		const tmp = `${dest}.download`;
		await Bun.write(tmp, res);
		renameSync(tmp, dest);
	})();

	inFlight.set(dest, task);
	try {
		await task;
	} finally {
		inFlight.delete(dest);
	}
}

export function startKokoroHubServer(): string {
	if (hub) {
		return hub.url.toString();
	}
	mkdirSync(hubCacheDirectory(), { recursive: true });
	console.log(`Kokoro HF files on disk: ${hubCacheDirectory()}`);

	hub = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		async fetch(req) {
			const u = new URL(req.url);
			if (req.method !== "GET") {
				return new Response("Method Not Allowed", { status: 405 });
			}
			const dest = safeHubFile(u.pathname);
			if (!dest) {
				return new Response("Bad path", { status: 400 });
			}
			try {
				await ensureOnDisk(u.pathname, dest);
			} catch (e) {
				const msg = e instanceof Error ? e.message : String(e);
				console.error("[kokoro-hub]", msg);
				return new Response(msg, { status: 502 });
			}
			if (!existsSync(dest)) {
				return new Response("Not found", { status: 404 });
			}
			const file = Bun.file(dest);
			const headers = new Headers({
				"Access-Control-Allow-Origin": "*",
				"Cache-Control": "public, max-age=31536000, immutable",
			});
			const ct = contentTypeFor(dest);
			if (ct) headers.set("Content-Type", ct);
			return new Response(file, { headers });
		},
	});

	const url = hub.url.toString();
	return url.endsWith("/") ? url : `${url}/`;
}

export function stopKokoroHubServer(): void {
	hub?.stop?.();
	hub = null;
}

function contentTypeFor(filePath: string): string | null {
	if (filePath.endsWith(".json")) return "application/json";
	if (filePath.endsWith(".onnx")) return "application/octet-stream";
	if (filePath.endsWith(".bin")) return "application/octet-stream";
	return null;
}
