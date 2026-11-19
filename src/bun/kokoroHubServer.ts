import {
	createReadStream,
	createWriteStream,
	existsSync,
	mkdirSync,
	renameSync,
	statSync,
} from "node:fs";
import { randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import { join, normalize, relative, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { modelCacheDir } from "./appConfigStore";
import { isUsableCachedFile } from "./hubDiskCache";
import { mainLog } from "./logBridge";
import { hubRequestPath } from "./securityGuards";

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
		// This branch only runs on a cache miss — a genuine download from HF.
		const name = hfPath.split("/").pop() || hfPath;
		mainLog({
			level: "info",
			source: "models",
			message: `Downloading ${name} from HuggingFace (not cached yet)…`,
		});
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
		const bytes = existsSync(dest) ? statSync(dest).size : 0;
		mainLog({
			level: "info",
			source: "models",
			message: `Cached ${name} (${(bytes / 1_048_576).toFixed(1)} MB).`,
		});
	})();

	inFlight.set(dest, task);
	try {
		await task;
	} finally {
		inFlight.delete(dest);
	}
}

/**
 * Start the local Kokoro model cache server. Only requests under a random
 * per-launch path token, for files of the Kokoro repo, are served, so other
 * local software and web pages can't use it as an open HuggingFace proxy.
 * `allowedOrigins` get a CORS grant (the renderer fetches from app://).
 */
export function startKokoroHubServer(
	allowedOrigins: readonly string[],
): Promise<string> {
	if (hub && hubBaseUrl) {
		return Promise.resolve(hubBaseUrl);
	}
	mkdirSync(hubCacheDirectory(), { recursive: true });
	console.log(`Kokoro HF files on disk: ${hubCacheDirectory()}`);
	const token = randomBytes(16).toString("hex");

	const server = createServer((req, res) => {
		void (async () => {
			const fail = (status: number, body: string) => {
				res.writeHead(status, { "Content-Type": "text/plain" });
				res.end(body);
			};
			const u = new URL(req.url ?? "/", "http://127.0.0.1");
			if (req.method !== "GET") return fail(405, "Method Not Allowed");
			const hfPath = hubRequestPath(u.pathname, token);
			const dest = hfPath ? safeHubFile(hfPath) : null;
			if (!hfPath || !dest) return fail(404, "Not found");
			try {
				await ensureOnDisk(hfPath, dest);
			} catch (e) {
				console.error("[kokoro-hub]", e instanceof Error ? e.message : String(e));
				return fail(502, "Download failed");
			}
			if (!existsSync(dest)) return fail(404, "Not found");
			const headers: Record<string, string> = {
				// The renderer is cross-origin isolated (COEP), so this cross-origin
				// model fetch needs an explicit resource policy to be allowed.
				"Cross-Origin-Resource-Policy": "cross-origin",
				"Cache-Control": "public, max-age=31536000, immutable",
				"Content-Type": "application/octet-stream",
				// transformers.js grows its buffer one chunk at a time (a full copy
				// each) without this: minutes, not seconds, for the 325 MB fp32 model.
				"Content-Length": String(statSync(dest).size),
				"X-Content-Type-Options": "nosniff",
				Vary: "Origin",
			};
			const origin = req.headers.origin;
			if (origin && allowedOrigins.includes(origin)) {
				headers["Access-Control-Allow-Origin"] = origin;
			}
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
			hubBaseUrl = `http://127.0.0.1:${address.port}/${token}/`;
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
