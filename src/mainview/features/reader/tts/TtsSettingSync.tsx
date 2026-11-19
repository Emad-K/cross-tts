import { useEffect, useRef } from "react";
import { voiceReadsCjk } from "./ttsChunkText";
import {
	restartPlaybackIfPlaying,
	seekToChunkAndMaybePlay,
	switchTtsEngine,
} from "./ttsEngine";
import { useTtsStore } from "./ttsStore";

/**
 * When voice, speed or quality steps change during playback, restart
 * synthesis from the current chunk; when the engine changes, unload the old one first.
 */
export function TtsSettingSync() {
	const engineId = useTtsStore((s) => s.engineId);
	const prevEngine = useRef(engineId);
	useEffect(() => {
		if (prevEngine.current === engineId) return;
		const previous = prevEngine.current;
		prevEngine.current = engineId;
		switchTtsEngine(previous);
	}, [engineId]);

	const voice = useTtsStore((s) => s.voice);
	const speed = useTtsStore((s) => s.speed);
	const steps = useTtsStore((s) => s.supertonicSteps);
	const prev = useRef({ engineId, voice, speed, steps });

	useEffect(() => {
		const p = prev.current;
		if (p.voice === voice && p.speed === speed && p.steps === steps) return;
		prev.current = { engineId, voice, speed, steps };
		if (voiceReadsCjk(p.engineId, p.voice) !== voiceReadsCjk(engineId, voice)) {
			// CJK-only sentences become speakable (or not): rebuild the chunks,
			// keeping the position, and restart there if playing.
			useTtsStore.getState().rechunk();
			seekToChunkAndMaybePlay(useTtsStore.getState().currentChunkIndex);
			return;
		}
		restartPlaybackIfPlaying();
	}, [engineId, voice, speed, steps]);

	return null;
}
