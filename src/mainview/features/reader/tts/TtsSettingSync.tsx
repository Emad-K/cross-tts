import { useEffect, useRef } from "react";
import { restartPlaybackIfPlaying, switchTtsEngine } from "./ttsEngine";
import { useTtsStore } from "./ttsStore";

/**
 * When voice or speed changes during playback, restart synthesis from the
 * current chunk; when the engine changes, unload the old one first.
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
	const prev = useRef({ voice, speed });

	useEffect(() => {
		const p = prev.current;
		if (p.voice === voice && p.speed === speed) return;
		prev.current = { voice, speed };
		restartPlaybackIfPlaying();
	}, [voice, speed]);

	return null;
}
