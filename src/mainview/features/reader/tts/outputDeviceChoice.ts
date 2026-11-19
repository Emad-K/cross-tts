/** Pure parts of the audio output picker (no DOM), unit-tested with bun. */

export type OutputDevice = { id: string; label: string };

/** Sink id of the operating system's default output. */
export const SYSTEM_DEFAULT_SINK = "";

/**
 * Selectable outputs from `enumerateDevices()`. Chromium's "default" and
 * "communications" entries are aliases of real devices, so they are dropped:
 * the picker has its own "System default" row.
 */
export function listOutputDevices(
	devices: readonly Pick<MediaDeviceInfo, "kind" | "deviceId" | "label">[],
): OutputDevice[] {
	const out: OutputDevice[] = [];
	for (const d of devices) {
		if (d.kind !== "audiooutput") continue;
		if (!d.deviceId || d.deviceId === "default" || d.deviceId === "communications") {
			continue;
		}
		out.push({ id: d.deviceId, label: d.label || `Output ${out.length + 1}` });
	}
	return out;
}

/**
 * Sink to play on: the preferred device while it is connected, otherwise the
 * system default. The preference itself is kept, so playback moves back when
 * the device returns. Ids can change (Chromium re-salts them when site data
 * is cleared), so a device with the same name also counts.
 */
export function resolveOutputSink(
	preferred: OutputDevice | null,
	devices: readonly OutputDevice[],
): string {
	if (!preferred) return SYSTEM_DEFAULT_SINK;
	const match =
		devices.find((d) => d.id === preferred.id) ??
		devices.find((d) => d.label === preferred.label);
	return match?.id ?? SYSTEM_DEFAULT_SINK;
}

/** The saved preference, or null (system default) for anything malformed. */
export function coerceOutputDevice(raw: unknown): OutputDevice | null {
	if (!raw || typeof raw !== "object") return null;
	const { id, label } = raw as Record<string, unknown>;
	if (typeof id !== "string" || !id || typeof label !== "string") return null;
	return { id, label };
}
