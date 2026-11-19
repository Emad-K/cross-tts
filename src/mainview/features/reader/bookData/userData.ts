import { showToast } from "@/components/toast/toastStore";
import { logWarn } from "../logging/logger";

type UserDataName = "notes" | "stats";

/** Read one user-data file from the data folder; null in the browser or when absent. */
export async function loadUserData(name: UserDataName): Promise<unknown> {
	try {
		return (await window.api?.request.readUserData({ name })) ?? null;
	} catch (err) {
		logWarn(`Couldn't load ${name}`, { source: "user-data", detail: String(err) });
		return null;
	}
}

/**
 * Saves a user-data file at most once per `delayMs`, and right away when the
 * window is hidden or closed so nothing is lost on quit.
 */
export function userDataSaver(
	name: UserDataName,
	getData: () => unknown,
	delayMs = 1000,
): { schedule: () => void; flush: () => void } {
	let timer: ReturnType<typeof setTimeout> | null = null;
	const flush = () => {
		if (timer === null) return;
		clearTimeout(timer);
		timer = null;
		window.api?.request.writeUserData({ name, data: getData() }).catch((err) => {
			logWarn(`Couldn't save ${name}`, { source: "user-data", detail: String(err) });
			showToast({
				title: name === "notes" ? "Couldn't save your notes" : "Couldn't save listening stats",
				description: err instanceof Error ? err.message : String(err),
				variant: "destructive",
			});
		});
	};
	window.addEventListener("pagehide", flush);
	document.addEventListener("visibilitychange", () => {
		if (document.visibilityState === "hidden") flush();
	});
	return {
		schedule: () => {
			timer ??= setTimeout(flush, delayMs);
		},
		flush,
	};
}
