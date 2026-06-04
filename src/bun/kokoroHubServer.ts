import {
	createReadStream,
	createWriteStream,
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	statSync,
} from "node:fs";
import { createServer, type Server } from "node:http";
import { join, normalize, relative, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { modelCacheDir } from "./appConfigStore";

const HF_ORIGIN = "https://huggingface.co";

let hub: Server | null = null;
let hubBaseUrl: string | null = null;
export const hubCacheDirectory = () => modelCacheDir();
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
		if (!res.ok || !res.body) {
			throw new Error(`Kokoro hub fetch failed ${res.status}: ${url}`);
		}
		const tmp = `${dest}.download`;
		await pipeline(
			Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]),
			createWriteStream(tmp),
		);
		renameSync(tmp, dest);
	})();

	inFlight.set(dest, task);
	try {
		await task;
	} finally {
		inFlight.delete(dest);
	}
}

export function startKokoroHubServer(): Promise<string> {
	if (hub && hubBaseUrl) {
		return Promise.resolve(hubBaseUrl);
	}
	mkdirSync(hubCacheDirectory(), { recursive: true });
	console.log(`Kokoro HF files on disk: ${hubCacheDirectory()}`);

	const server = createServer((req, res) => {
		void (async () => {
			const u = new URL(req.url ?? "/", "http://127.0.0.1");
			if (req.method !== "GET") {
				res.writeHead(405);
				res.end("Method Not Allowed");
				return;
			}
			const dest = safeHubFile(u.pathname);
			if (!dest) {
				res.writeHead(400);
				res.end("Bad path");
				return;
			}
			try {
				await ensureOnDisk(u.pathname, dest);
			} catch (e) {
				const msg = e instanceof Error ? e.message : String(e);
				console.error("[kokoro-hub]", msg);
				res.writeHead(502);
				res.end(msg);
				return;
			}
			if (!existsSync(dest)) {
				res.writeHead(404);
				res.end("Not found");
				return;
			}
			const headers: Record<string, string> = {
				"Access-Control-Allow-Origin": "*",
				"Cache-Control": "public, max-age=31536000, immutable",
			};
			const ct = contentTypeFor(dest);
			if (ct) headers["Content-Type"] = ct;
			res.writeHead(200, headers);
			createReadStream(dest)
				.on("error", () => {
					if (!res.headersSent) res.writeHead(500);
					res.end();
				})
				.pipe(res);
		})();
	});

	hub = server;

	// `listen()` is asynchronous: the socket is not bound (and `address()` is
	// null) until the "listening" event fires. Wait for it before reading the
	// port, otherwise we'd always think binding failed and fall back to remote.
	return new Promise<string>((resolveStart, rejectStart) => {
		const onError = (err: Error) => {
			server.off("listening", onListening);
			hub = null;
			rejectStart(err);
		};
		const onListening = () => {
			server.off("error", onError);
			const address = server.address();
			if (!address || typeof address === "string") {
				hub = null;
				rejectStart(new Error("Kokoro hub server failed to bind a port"));
				return;
			}
			hubBaseUrl = `http://127.0.0.1:${address.port}/`;
			resolveStart(hubBaseUrl);
		};
		server.once("error", onError);
		server.once("listening", onListening);
		server.listen(0, "127.0.0.1");
	});
}

export function stopKokoroHubServer(): void {
	hub?.close();
	hub = null;
	hubBaseUrl = null;
}

function contentTypeFor(filePath: string): string | null {
	if (filePath.endsWith(".json")) return "application/json";
	if (filePath.endsWith(".onnx")) return "application/octet-stream";
	if (filePath.endsWith(".bin")) return "application/octet-stream";
	return null;
}
