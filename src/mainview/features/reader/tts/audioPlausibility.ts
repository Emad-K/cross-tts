/**
 * Coarse sanity check on synthesized PCM before it is played, cached or
 * exported. A GPU run that hit out-of-memory can return finite-looking but
 * wrong audio without throwing (ORT-web drops the error); this catches the
 * gross cases (NaN/Inf, wild clipping, near-silence) — not subtle distortion.
 *
 * Kokoro speech on CPU peaks well under 1.0 with RMS around 0.03–0.1, so the
 * bounds below leave a wide margin for quiet or short sentences.
 */
const MAX_PEAK = 4;
const MIN_RMS = 1e-5;

export function isPlausibleAudio(audio: Float32Array): boolean {
	if (audio.length === 0) return false;
	let peak = 0;
	let sumSq = 0;
	for (let i = 0; i < audio.length; i++) {
		const s = audio[i]!;
		if (!Number.isFinite(s)) return false;
		const a = Math.abs(s);
		if (a > peak) peak = a;
		sumSq += s * s;
	}
	if (peak > MAX_PEAK) return false;
	return Math.sqrt(sumSq / audio.length) >= MIN_RMS;
}
