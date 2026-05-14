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
 * Fetch every Kokoro voice `.bin` into the Cache API (same store `kokoro-js` uses at runtime).
 */
export async function prefetchAllVoiceBins(options?: {
	onProgress?: (loaded: number, total: number) => void;
	concurrency?: number;
	signal?: AbortSignal;
}): Promise<void> {
	const { onProgress, concurrency = 4, signal } = options ?? {};
	const cache = await openVoiceCache();
	const total = KOKORO_VOICE_IDS.length;
	let loaded = 0;

	const bump = () => {
		loaded += 1;
		onProgress?.(loaded, total);
	};

	const fetchOne = async (id: string) => {
		if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
		const hub = getKokoroHubBaseUrlSync();
		const url = hub ? voiceBinUrlFromHub(hub, id) : voiceBinUrl(id);
		if (cache) {
			const hit = await cache.match(url);
			if (hit) {
				bump();
				return;
			}
		}
		const res = await fetch(url, { signal });
		if (!res.ok) throw new Error(`Failed to fetch voice ${id}: ${res.status}`);
		const body = await res.arrayBuffer();
		if (cache) {
			try {
				await cache.put(
					url,
					new Response(body, {
						headers: { "Content-Type": "application/octet-stream" },
					}),
				);
			} catch {
				// ignore quota / private mode
			}
		}
		bump();
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
