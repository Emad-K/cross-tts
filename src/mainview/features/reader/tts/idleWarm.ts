import type { PlaybackPhase, ModelPhase } from "./ttsStore";

/**
 * Idle warm-up: while nothing is playing, the sentence the next press of play
 * starts on is synthesized into the audio cache, so play starts from cache
 * hits instead of waiting on the model. The pieces here are pure; the store
 * subscription and the synthesis live in ttsEngine.ts (startIdleWarm).
 */

/** Wait this long after the position or voice settles before warming. */
export const IDLE_WARM_DELAY_MS = 400;

type WarmState = {
	modelPhase: ModelPhase;
	playback: PlaybackPhase;
	engineId: string;
	voice: string;
	speed: number;
	supertonicSteps: number;
	chunks: readonly { text: string }[];
	currentChunkIndex: number;
};

/**
 * Names the audio the next press of play needs first. Null when there is
 * nothing to warm: no model loaded (warming never triggers a model load),
 * playback running (the loop makes its own audio), or no text.
 */
export function idleWarmKey(s: WarmState): string | null {
	if (s.modelPhase !== "ready") return null;
	if (s.playback !== "idle" && s.playback !== "paused") return null;
	const text = s.chunks[s.currentChunkIndex]?.text;
	if (!text) return null;
	return JSON.stringify([
		s.engineId,
		s.voice,
		s.speed,
		s.supertonicSteps,
		s.currentChunkIndex,
		text,
	]);
}

/**
 * Debounce `warm` by key: it runs once, `delayMs` after the key last changed
 * to a non-null value. Repeats of the same key do nothing; null cancels a
 * pending run and forgets the key, so the same position warms again later
 * (a cheap cache check when its audio is still there).
 */
export function createIdleWarmer(
	warm: () => void,
	delayMs = IDLE_WARM_DELAY_MS,
): (key: string | null) => void {
	let last: string | null = null;
	let timer: ReturnType<typeof setTimeout> | undefined;
	return (key) => {
		if (key === last) return;
		last = key;
		clearTimeout(timer);
		if (key !== null) timer = setTimeout(warm, delayMs);
	};
}
