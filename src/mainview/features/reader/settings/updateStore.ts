import { create } from "zustand";
import { IDLE_UPDATE_STATUS, type UpdateStatus } from "@shared/updateStatus";
import { showToast } from "@/components/toast/toastStore";
import {
	getUpdateStatus,
	quitAndInstallUpdate,
	subscribeToUpdateStatus,
} from "@/lib/desktopBridge";

type UpdateStore = {
	status: UpdateStatus;
	setStatus: (status: UpdateStatus) => void;
};

/** Mirror of the main process's update state (see src/bun/autoUpdate.ts). */
export const useUpdateStore = create<UpdateStore>((set) => ({
	status: IDLE_UPDATE_STATUS,
	setStatus: (status) => set({ status }),
}));

let toastedVersion: string | null = null;

function announceIfReady(status: UpdateStatus): void {
	if (status.state !== "ready") return;
	const version = status.version ?? "";
	if (toastedVersion === version) return;
	toastedVersion = version;
	showToast({
		title: version
			? `Cross TTS ${version} is ready to install`
			: "An update is ready to install",
		description: "Restart now to update, or it installs when you next quit.",
		action: {
			label: "Restart now",
			onClick: () => void quitAndInstallUpdate(),
		},
		durationMs: null,
	});
}

/**
 * Keep the store in sync with main-process update events and show a sticky
 * "restart to update" toast (once per version) when a download completes.
 * Call once at app start; returns an unsubscribe fn. No-op on web.
 */
export function initUpdateStatusSync(): () => void {
	void getUpdateStatus().then((status) => {
		if (!status) return;
		useUpdateStore.getState().setStatus(status);
		announceIfReady(status);
	});
	return subscribeToUpdateStatus((status) => {
		useUpdateStore.getState().setStatus(status);
		announceIfReady(status);
	});
}
