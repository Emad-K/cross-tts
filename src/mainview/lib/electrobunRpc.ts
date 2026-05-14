import { Electroview } from "electrobun/view";
import type { AppRpcSchema } from "@shared/appRpc";

const w = typeof window !== "undefined" ? window : undefined;
const webviewId = (w as unknown as { __electrobunWebviewId?: number })
	?.__electrobunWebviewId;
const rpcPort = (w as unknown as { __electrobunRpcSocketPort?: number })
	?.__electrobunRpcSocketPort;

export const isElectrobunWebview =
	typeof webviewId === "number" && typeof rpcPort === "number";

let rpc: ReturnType<typeof Electroview.defineRPC<AppRpcSchema>> | null = null;
let electroviewStarted = false;

function ensureElectroview(): ReturnType<
	typeof Electroview.defineRPC<AppRpcSchema>
> | null {
	if (!isElectrobunWebview) return null;
	if (!rpc) {
		rpc = Electroview.defineRPC<AppRpcSchema>({
			handlers: { requests: {}, messages: {} },
		});
	}
	if (!electroviewStarted) {
		electroviewStarted = true;
		new Electroview({ rpc });
	}
	return rpc;
}

export async function getKokoroHubBaseUrl(): Promise<string | null> {
	const r = ensureElectroview();
	if (!r) return null;
	return r.request.getKokoroHubBaseUrl();
}
