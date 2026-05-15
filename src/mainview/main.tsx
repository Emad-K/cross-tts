import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { bootElectrobunMainView } from "./lib/electrobunRpc";
import "./index.css";
import App from "./App";

bootElectrobunMainView();

createRoot(document.getElementById("root")!).render(
	<StrictMode>
		<App />
	</StrictMode>,
);
