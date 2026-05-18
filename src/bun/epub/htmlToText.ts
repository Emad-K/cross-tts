import {
	decodeHtmlEntities,
	finalizePlainText,
	htmlToPlainText,
} from "../../shared/htmlPlainText";

export { decodeHtmlEntities, finalizePlainText, htmlToPlainText };

/** Remove executable content before rendering EPUB HTML in the webview. */
export function sanitizeEpubHtml(html: string): string {
	return html
		.replace(/<script[\s\S]*?<\/script>/gi, "")
		.replace(/<style[\s\S]*?<\/style>/gi, "")
		.replace(/\s+on\w+="[^"]*"/gi, "")
		.replace(/\s+on\w+='[^']*'/gi, "");
}
