import { getKokoroHubBaseUrlSync } from "./kokoroHubConfig";
import {
	KOKORO_VOICE_IDS,
	voiceBinUrl,
	voiceBinUrlFromHub,
} from "./kokoroVoices";

const VOICE_CACHE = "kokoro-voices";

async function openVoiceCache(): Promise<Cache | undefined> {
	try {
		return await caches.open(VOICE_CACHE);
	} catch {
		return undefined;
	}
}

/**
 * Make sure one voice `.bin` is in the Cache API store kokoro-js reads.
 *
 * The cache key is always the canonical huggingface.co URL: that is the
 * exact key kokoro-js looks up before falling back to fetching from
 * huggingface.co itself. The bytes come from the local hub when there is
 * one. Keying by the hub URL (random port, per-launch token) missed on
 * every launch and was never seen by kokoro-js, so voices weren't offline.
 */
export async function cacheVoiceBin(
	id: string,
	hubBaseUrl: string | null,
	signal?: AbortSignal,
): Promise<void> {
	const cache = await openVoiceCache();
	const key = voiceBinUrl(id);
	if (cache && (await cache.match(key))) return;
	// Bytes always come from the pinned revision (hub, else huggingface.co).
	const url = voiceBinUrlFromHub(hubBaseUrl ?? "https://huggingface.co/", id);
	const res = await fetch(url, { signal });
	if (!res.ok) throw new Error(`Failed to fetch voice ${id}: ${res.status}`);
	const body = await res.arrayBuffer();
	if (!cache) return;
	try {
		await cache.put(
			key,
			new Response(body, {
				headers: { "Content-Type": "application/octet-stream" },
			}),
		);
	} catch {
		// ignore quota / private mode
	}
}

/**
 * Fetch every Kokoro voice `.bin` into the Cache API (same store `kokoro-js` uses at runtime).
 */
export async function prefetchAllVoiceBins(options?: {
	onProgress?: (loaded: number, total: number) => void;
	concurrency?: number;
	signal?: AbortSignal;
}): Promise<void> {
	const { onProgress, concurrency = 4, signal } = options ?? {};
	const total = KOKORO_VOICE_IDS.length;
	let loaded = 0;

	const fetchOne = async (id: string) => {
		if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
		await cacheVoiceBin(id, getKokoroHubBaseUrlSync(), signal);
		loaded += 1;
		onProgress?.(loaded, total);
	};

	const queue = [...KOKORO_VOICE_IDS];
	const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
		while (queue.length > 0) {
			const id = queue.shift();
			if (!id) break;
			await fetchOne(id);
		}
	});
	await Promise.all(workers);
}
