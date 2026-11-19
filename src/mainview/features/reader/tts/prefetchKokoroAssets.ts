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
 * Return one voice `.bin`, caching it in the Cache API store.
 *
 * The cache key is always the canonical huggingface.co URL so it survives
 * relaunches (the hub URL has a random port and per-launch token). The bytes
 * come from the local hub when there is one.
 */
export async function cacheVoiceBin(
	id: string,
	hubBaseUrl: string | null,
	signal?: AbortSignal,
): Promise<ArrayBuffer> {
	const cache = await openVoiceCache();
	const key = voiceBinUrl(id);
	const hit = await cache?.match(key);
	if (hit) return hit.arrayBuffer();
	const url = hubBaseUrl ? voiceBinUrlFromHub(hubBaseUrl, id) : key;
	const res = await fetch(url, { signal });
	if (!res.ok) throw new Error(`Failed to fetch voice ${id}: ${res.status}`);
	const body = await res.arrayBuffer();
	if (!cache) return body;
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
	return body;
}

/**
 * Fetch every Kokoro voice `.bin` into the Cache API (the store the TTS worker reads).
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
