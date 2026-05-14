import { useEffect, useRef } from "react";
import { restartPlaybackIfPlaying } from "./ttsEngine";
import { useTtsStore } from "./ttsStore";

/**
 * When voice or speed changes during playback, restart synthesis from the current chunk.
 */
export function TtsSettingSync() {
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
