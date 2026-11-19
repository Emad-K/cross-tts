import { Volume2 } from "lucide-react";
import { create } from "zustand";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuLabel,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
	type OutputDevice,
	SYSTEM_DEFAULT_SINK,
	coerceOutputDevice,
	listOutputDevices,
	resolveOutputSink,
} from "./tts/outputDeviceChoice";
import { setOutputDevice } from "./tts/ttsEngine";

const STORAGE_KEY = "cross-tts-output-device";

/** Routing needs AudioContext.setSinkId (Chromium 110+) and a device list. */
const supported =
	typeof AudioContext !== "undefined" &&
	"setSinkId" in AudioContext.prototype &&
	typeof navigator !== "undefined" &&
	typeof navigator.mediaDevices?.enumerateDevices === "function";

function loadPreferred(): OutputDevice | null {
	try {
		return coerceOutputDevice(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null"));
	} catch {
		return null;
	}
}

type OutputDeviceState = {
	/** Connected outputs, without the system default. */
	devices: OutputDevice[];
	/** The user's choice; null = system default. Kept while unplugged. */
	preferred: OutputDevice | null;
};

const useOutputDeviceStore = create<OutputDeviceState>(() => ({
	devices: [],
	preferred: loadPreferred(),
}));

/** Re-read the device list and route playback to the best match. */
async function refreshOutputDevices(): Promise<void> {
	let devices: OutputDevice[] = [];
	try {
		devices = listOutputDevices(await navigator.mediaDevices.enumerateDevices());
	} catch {
		// No device list: play on the system default.
	}
	useOutputDeviceStore.setState({ devices });
	setOutputDevice(
		resolveOutputSink(useOutputDeviceStore.getState().preferred, devices),
	);
}

function chooseOutputDevice(id: string): void {
	const { devices } = useOutputDeviceStore.getState();
	const preferred = devices.find((d) => d.id === id) ?? null;
	useOutputDeviceStore.setState({ preferred });
	try {
		if (preferred) localStorage.setItem(STORAGE_KEY, JSON.stringify(preferred));
		else localStorage.removeItem(STORAGE_KEY);
	} catch {
		// The choice still applies for this run.
	}
	setOutputDevice(resolveOutputSink(preferred, devices));
}

if (supported) {
	void refreshOutputDevices();
	// Unplugging the chosen device falls back to the system default; plugging
	// it back in returns to it.
	navigator.mediaDevices.addEventListener("devicechange", () => {
		void refreshOutputDevices();
	});
}

/**
 * Audio output picker for the player: the speaker icon beside the volume
 * slider becomes a menu of connected outputs. Renders nothing (leaving the
 * plain icon) when the platform can't route audio or there is only the
 * system default to choose from.
 */
export function OutputDeviceControl() {
	const devices = useOutputDeviceStore((s) => s.devices);
	const preferred = useOutputDeviceStore((s) => s.preferred);
	if (!supported || (devices.length === 0 && !preferred)) return null;

	const sink = resolveOutputSink(preferred, devices);
	const current =
		devices.find((d) => d.id === sink)?.label ?? "System default";
	const missing = preferred != null && sink === SYSTEM_DEFAULT_SINK;

	return (
		<DropdownMenu onOpenChange={(open) => open && void refreshOutputDevices()}>
			<DropdownMenuTrigger asChild>
				<Button
					type="button"
					variant="ghost"
					size="icon"
					// Stands in for the decorative speaker icon that follows it.
					className="-mx-1.5 size-7 shrink-0 text-muted-foreground hover:text-foreground [&+svg]:hidden"
					aria-label={`Audio output: ${current}`}
					title={`Audio output: ${current}`}
				>
					<Volume2 className="size-4" aria-hidden />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="min-w-[14rem] max-w-xs">
				<DropdownMenuLabel>Play sound on</DropdownMenuLabel>
				<DropdownMenuRadioGroup value={sink} onValueChange={chooseOutputDevice}>
					<DropdownMenuRadioItem value={SYSTEM_DEFAULT_SINK}>
						System default
					</DropdownMenuRadioItem>
					{devices.map((d) => (
						<DropdownMenuRadioItem key={d.id} value={d.id}>
							{d.label}
						</DropdownMenuRadioItem>
					))}
				</DropdownMenuRadioGroup>
				{missing ? (
					<p className="px-2 py-1.5 text-xs text-muted-foreground">
						{preferred.label} isn't connected. Using the system default until
						it's back.
					</p>
				) : null}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
