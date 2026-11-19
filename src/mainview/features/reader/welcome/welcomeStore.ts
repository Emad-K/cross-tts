import { create } from "zustand";

/** Whether the welcome is open: on first run, or from Settings → General. */
export const useWelcomeStore = create<{ open: boolean }>(() => ({ open: false }));

export const openWelcome = () => useWelcomeStore.setState({ open: true });
export const closeWelcome = () => useWelcomeStore.setState({ open: false });
