import { useEffect, useRef } from "react";
import { restartPlaybackIfPlaying } from "../tts/ttsEngine";
import { useTtsRulesStore } from "./ttsRulesStore";

/** Restart synthesis when text-transform rules change during playback. */
export function TtsRulesSettingSync() {
	const signature = useTtsRulesStore((s) => s.signature);
	const prev = useRef(signature);

	useEffect(() => {
		if (prev.current === signature) return;
		prev.current = signature;
		restartPlaybackIfPlaying();
	}, [signature]);

	return null;
}
