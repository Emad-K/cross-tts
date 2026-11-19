import { AudioCache, audioCacheKey } from "./ttsAudioCache";
import { CANCELLED } from "./synthJobQueue";
import type { TtsBackendPrefs, TtsEngine } from "./ttsEngineTypes";

/**
 * Engine-independent synthesis core of the orchestrator: the chunk audio
 * cache, playback epochs, and the retry after a backend failure. No DOM or
 * store access, so it can be driven with a fake engine in tests; the
 * cached value type is generic (AudioBuffer in the app).
 */
export class SynthCore<V> {
	/**
	 * Playback epoch, bumped whenever the loop is interrupted (seek, voice/speed
	 * change, stop). Playback requests carry it; engines drop queued jobs from
	 * older epochs so the wanted chunk doesn't wait behind stale prefetches.
	 * Starts at the clock so a reloaded renderer never sends epochs lower than
	 * ones a still-running native process already saw.
	 */
	epoch = Date.now();
	private readonly cache: AudioCache<V>;
	/** Latest epoch in which playback asked for each not-yet-cached chunk. */
	private readonly wantedAtEpoch = new Map<string, number>();

	constructor(
		private readonly deps: {
			engine: () => TtsEngine;
			prefs: () => TtsBackendPrefs;
			rulesSignature: () => string;
			/** Chunk text as the engine should read it (regex rules, normalization). */
			prepareText: (chunkText: string) => string;
			/** Cache bound in `cacheCost` units (default: 64 entries). */
			cacheMax?: number;
			cacheCost?: (value: V) => number;
		},
	) {
		this.cache = new AudioCache<V>(deps.cacheMax ?? 64, deps.cacheCost);
	}

	key(chunkText: string, voice: string, speed: number): string {
		const engine = this.deps.engine();
		return audioCacheKey(
			engine.cacheTag ? `${engine.id}#${engine.cacheTag()}` : engine.id,
			chunkText,
			voice,
			speed,
			this.deps.rulesSignature(),
		);
	}

	/** True when this chunk's audio is already synthesized. */
	has(chunkText: string, voice: string, speed: number): boolean {
		return this.cache.has(this.key(chunkText, voice, speed));
	}

	/** True while this chunk is being synthesized for playback or prefetch. */
	inFlight(chunkText: string, voice: string, speed: number): boolean {
		return this.cache.isInFlight(this.key(chunkText, voice, speed));
	}

	clear(): void {
		this.cache.clear();
	}

	/**
	 * Drop cached audio whenever one of `engines` resets its backend (GPU→CPU
	 * fallback, crashed or timed-out worker), so audio from the old backend
	 * isn't replayed after the switch.
	 */
	clearOnReset(engines: readonly TtsEngine[]): void {
		for (const engine of engines) engine.onReset = () => this.clear();
	}

	/**
	 * Synthesize one chunk, recovering from a failed backend and retrying once
	 * when the engine says a retry may succeed (GPU fault → CPU, crashed
	 * native process → fresh one). Used by both playback and export.
	 */
	async generate(
		chunkText: string,
		voice: string,
		speed: number,
		epoch?: number,
	): Promise<Float32Array | null> {
		const engine = this.deps.engine();
		const text = this.deps.prepareText(chunkText);
		const backend = engine.activeBackend();
		try {
			return await engine.synthesize(text, voice, speed, { epoch });
		} catch (e) {
			const message = e instanceof Error ? e.message : String(e);
			if (message === CANCELLED || !backend) throw e;
			if (!engine.recover?.(backend, message)) throw e;
			await engine.ensureLoaded(this.deps.prefs());
			return engine.synthesize(text, voice, speed, { epoch });
		}
	}

	/**
	 * Cached, de-duplicated playback synthesis under the current epoch, so
	 * seeks, re-reads, and the loop catching up to its own prefetch never
	 * re-run the model. Null = nothing to speak.
	 */
	get(
		chunkText: string,
		voice: string,
		speed: number,
		toValue: (pcm: Float32Array, sampleRate: number) => V | Promise<V>,
	): Promise<V | null> {
		const key = this.key(chunkText, voice, speed);
		const { sampleRate } = this.deps.engine();
		if (!this.cache.has(key)) this.wantedAtEpoch.set(key, this.epoch);
		const engine = this.deps.engine();
		return this.cache.getOrCreate(key, async () => {
			try {
				for (;;) {
					const epoch = this.epoch;
					let pcm: Float32Array | null;
					try {
						pcm = await this.generate(chunkText, voice, speed, epoch);
					} catch (e) {
						// The engine dropped this as stale, but playback asked for the
						// same chunk again after the epoch moved on (e.g. "next" joined
						// a pending prefetch): ask again under the current epoch.
						if (
							e instanceof Error &&
							e.message === CANCELLED &&
							epoch !== this.epoch &&
							this.wantedAtEpoch.get(key) === this.epoch
						) {
							continue;
						}
						// Errors (including "cancelled") throw, so they are never cached.
						throw e;
					}
					if (!pcm) return null;
					const value = await toValue(pcm, sampleRate);
					// A backend reset meanwhile (GPU fault → CPU) cleared the cache,
					// so `key` won't be stored and may name the old precision: file
					// the audio under the key lookups use now. A no-op otherwise
					// (it joins this very in-flight entry).
					if (this.deps.engine() === engine) {
						void this.cache.getOrCreate(
							this.key(chunkText, voice, speed),
							async () => value,
						);
					}
					return value;
				}
			} finally {
				this.wantedAtEpoch.delete(key);
			}
		});
	}
}
