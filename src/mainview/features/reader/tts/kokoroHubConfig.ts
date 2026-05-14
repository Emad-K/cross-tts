/** Set by `configureKokoroHubEnv` when running inside Electrobun (localhost hub). */
let hubBaseUrl: string | null = null;

export function setKokoroHubBaseUrl(url: string | null): void {
	hubBaseUrl = url?.endsWith("/") ? url : url ? `${url}/` : null;
}

export function getKokoroHubBaseUrlSync(): string | null {
	return hubBaseUrl;
}
