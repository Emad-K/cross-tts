import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
// Self-hosted reading fonts (bundled for offline use).
import "@fontsource/inter/400.css";
import "@fontsource/inter/600.css";
import "@fontsource/atkinson-hyperlegible/400.css";
import "@fontsource/atkinson-hyperlegible/700.css";
import "@fontsource/literata/400.css";
import "@fontsource/literata/600.css";
import "@fontsource/lora/400.css";
import "@fontsource/lora/600.css";
import "@fontsource/opendyslexic/400.css";
import "@fontsource/opendyslexic/700.css";
import { defaultAppearance } from "@shared/appearance";
import { applyAppearance } from "./features/reader/settings/applyAppearance";
import App from "./App";

// Apply the default (system) appearance before first paint, refined once the
// persisted config hydrates — avoids a light/dark flash on launch.
applyAppearance(defaultAppearance());

createRoot(document.getElementById("root")!).render(
	<StrictMode>
		<App />
	</StrictMode>,
);
