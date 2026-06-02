/** Set by `configureKokoroHubEnv` when running inside the Electron app (localhost hub). */
let hubBaseUrl: string | null = null;

export function setKokoroHubBaseUrl(url: string | null): void {
	hubBaseUrl = url?.endsWith("/") ? url : url ? `${url}/` : null;
}

export function getKokoroHubBaseUrlSync(): string | null {
	return hubBaseUrl;
}
