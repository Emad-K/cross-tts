/** Auto-update lifecycle state pushed from the main process to the renderer. */
export type UpdateStatus = {
	state: "idle" | "checking" | "downloading" | "ready" | "up-to-date" | "error";
	/** Version being downloaded / ready to install, when known. */
	version?: string;
	/** Human-readable detail for state "error". */
	error?: string;
};

export const IDLE_UPDATE_STATUS: UpdateStatus = { state: "idle" };
