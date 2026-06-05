export { buildTtsChunks, normalizedReaderText } from "./chunkText";
export type { TtsChunk } from "./chunkText";
export { KOKORO_MODEL_ID, KOKORO_VOICE_IDS } from "./kokoroVoices";
export type { KokoroVoiceId } from "./kokoroVoices";
export { prefetchAllVoiceBins } from "./prefetchKokoroAssets";
export { TtsSettingSync } from "./TtsSettingSync";
export {
	adjustVolume,
	downloadVoicesAndModel,
	ensureKokoroLoaded,
	getActiveDevice,
	resetKokoroEngine,
	pausePlayback,
	resumePlayback,
	seekProgressPercent,
	seekToChunkAndMaybePlay,
	setChapterPlaybackFinishedHandler,
	setVolumeLive,
	skipChunk,
	startOrResumePlayback,
	stopPlaybackUi,
	synthesizeChunkPcm,
	toggleMute,
	togglePlayPause,
} from "./ttsEngine";
export { useTtsStore } from "./ttsStore";
