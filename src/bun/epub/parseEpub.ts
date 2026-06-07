import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join, normalize } from "node:path";
import { XMLParser } from "fast-xml-parser";
import JSZip from "jszip";
import type { ReaderChapter } from "../../shared/readerTypes";
import { htmlToPlainText, sanitizeEpubHtml } from "./htmlToText";

const xml = new XMLParser({
	ignoreAttributes: false,
	attributeNamePrefix: "@_",
});

type ManifestItem = {
	id: string;
	href: string;
	mediaType: string;
	properties?: string;
};

type EpubArchive = {
	zip: JSZip;
	opfDir: string;
	title: string;
	manifest: Map<string, ManifestItem>;
	spineIds: string[];
	hrefToId: Map<string, string>;
	/** Manifest id of the cover image from `<meta name="cover">` (EPUB 2). */
	coverId?: string;
};

type ParsedEpub = EpubArchive & {
	chapters: ReaderChapter[];
};

const epubCache = new Map<string, ParsedEpub>();

function asArray<T>(value: T | T[] | undefined): T[] {
	if (value == null) return [];
	return Array.isArray(value) ? value : [value];
}

function asRecordArray(value: unknown): Record<string, unknown>[] {
	return asArray(value as Record<string, unknown> | Record<string, unknown>[]);
}

function textContent(node: unknown): string {
	if (node == null) return "";
	if (typeof node === "string" || typeof node === "number") {
		return String(node).trim();
	}
	if (typeof node === "object" && node !== null && "#text" in node) {
		return String((node as { "#text": unknown })["#text"]).trim();
	}
	return "";
}

function resolveHref(opfDir: string, href: string): string {
	const combined = normalize(join(opfDir, decodeURIComponent(href))).replace(
		/\\/g,
		"/",
	);
	return combined.startsWith("/") ? combined.slice(1) : combined;
}

/** Resolved manifest href → manifest id (first wins). */
export function buildManifestHrefLookup(
	manifest: Map<string, ManifestItem>,
	opfDir: string,
): Map<string, string> {
	const lookup = new Map<string, string>();
	for (const [id, item] of manifest) {
		const resolved = resolveHref(opfDir, item.href);
		if (!lookup.has(resolved)) lookup.set(resolved, id);
	}
	return lookup;
}

function findManifestIdByHref(
	hrefToId: Map<string, string>,
	opfDir: string,
	hrefPart: string,
): string | null {
	if (!hrefPart) return null;
	const target = resolveHref(opfDir, hrefPart);
	return hrefToId.get(target) ?? null;
}

async function readZipEntry(zip: JSZip, path: string): Promise<string | null> {
	const entry = zip.file(path.replace(/^\//, ""));
	if (!entry) return null;
	return entry.async("string");
}

async function readEpubFileBytes(filePath: string): Promise<Uint8Array | null> {
	try {
		if (!existsSync(filePath)) return null;
		return new Uint8Array(await readFile(filePath));
	} catch {
		return null;
	}
}

function parseOpf(
	opfXml: string,
	opfPath: string,
): Omit<EpubArchive, "zip"> {
	const opfDir = dirname(opfPath).replace(/\\/g, "/");
	const root = xml.parse(opfXml) as Record<string, unknown>;
	const pkg =
		(root.package as Record<string, unknown> | undefined) ??
		(root["opf:package"] as Record<string, unknown> | undefined) ??
		root;
	const metadata =
		(pkg.metadata as Record<string, unknown> | undefined) ?? {};
	const title =
		textContent(metadata["dc:title"]) ||
		textContent(metadata.title) ||
		"Untitled";

	const manifest: Map<string, ManifestItem> = new Map();
	const manifestNode = pkg.manifest as Record<string, unknown> | undefined;
	for (const item of asRecordArray(manifestNode?.item)) {
		const id = String(item["@_id"] ?? "");
		const href = String(item["@_href"] ?? "");
		if (!id || !href) continue;
		manifest.set(id, {
			id,
			href,
			mediaType: String(item["@_media-type"] ?? ""),
			properties: item["@_properties"]
				? String(item["@_properties"])
				: undefined,
		});
	}

	const spineIds: string[] = [];
	const spineNode = pkg.spine as Record<string, unknown> | undefined;
	for (const ref of asRecordArray(spineNode?.itemref)) {
		const idref = String(ref["@_idref"] ?? "");
		if (idref) spineIds.push(idref);
	}

	let coverId: string | undefined;
	for (const m of asRecordArray(metadata.meta)) {
		if (String(m["@_name"] ?? "").toLowerCase() === "cover") {
			coverId = String(m["@_content"] ?? "") || undefined;
			break;
		}
	}

	const hrefToId = buildManifestHrefLookup(manifest, opfDir);
	return { opfDir, title, manifest, spineIds, hrefToId, coverId };
}

function chaptersFromNavOl(
	ol: Record<string, unknown> | undefined,
	opfDir: string,
	hrefToId: Map<string, string>,
	level: number,
	out: ReaderChapter[],
): void {
	for (const li of asRecordArray(ol?.li)) {
		const anchor = li.a as Record<string, unknown> | undefined;
		const hrefRaw = anchor ? String(anchor["@_href"] ?? "") : "";
		const title = anchor ? textContent(anchor) : textContent(li);
		const [pathPart] = hrefRaw.split("#");
		const chapterId = findManifestIdByHref(hrefToId, opfDir, pathPart);
		if (chapterId && title) {
			out.push({ id: chapterId, title, level });
		}
		const nested = li.ol as Record<string, unknown> | undefined;
		if (nested) {
			chaptersFromNavOl(nested, opfDir, hrefToId, level + 1, out);
		}
	}
}

async function chaptersFromNavXhtml(
	zip: JSZip,
	navHref: string,
	opfDir: string,
	hrefToId: Map<string, string>,
): Promise<ReaderChapter[]> {
	const navPath = resolveHref(opfDir, navHref);
	const raw = await readZipEntry(zip, navPath);
	if (!raw) return [];
	const doc = xml.parse(raw) as Record<string, unknown>;
	const html = (doc.html as Record<string, unknown> | undefined) ?? doc;
	const body = (html.body as Record<string, unknown> | undefined) ?? html;
	const nav = findNavElement(body);
	if (!nav) return [];
	const ol = nav.ol as Record<string, unknown> | undefined;
	const chapters: ReaderChapter[] = [];
	chaptersFromNavOl(ol, opfDir, hrefToId, 0, chapters);
	return chapters;
}

function findNavElement(node: Record<string, unknown>): Record<string, unknown> | null {
	if (node.nav) {
		const navs = asRecordArray(node.nav);
		const toc =
			navs.find((n) =>
				String(n["@_epub:type"] ?? n["@_type"] ?? "").includes("toc"),
			) ?? navs[0];
		return (toc as Record<string, unknown> | undefined) ?? null;
	}
	for (const value of Object.values(node)) {
		if (typeof value === "object" && value !== null && !Array.isArray(value)) {
			const found = findNavElement(value as Record<string, unknown>);
			if (found) return found;
		}
	}
	return null;
}

function chaptersFromNcx(
	ncxXml: string,
	opfDir: string,
	hrefToId: Map<string, string>,
): ReaderChapter[] {
	const root = xml.parse(ncxXml) as Record<string, unknown>;
	const ncx =
		(root.ncx as Record<string, unknown> | undefined) ??
		(root["ncx:ncx"] as Record<string, unknown> | undefined) ??
		root;
	const navMap = ncx.navMap as Record<string, unknown> | undefined;
	const chapters: ReaderChapter[] = [];

	function walk(parent: Record<string, unknown>, level: number) {
		for (const point of asRecordArray(parent.navPoint)) {
			const label = point.navLabel as Record<string, unknown> | undefined;
			const title = textContent(label?.text);
			const content = point.content as Record<string, unknown> | undefined;
			const src = content ? String(content["@_src"] ?? "") : "";
			const [pathPart] = src.split("#");
			const chapterId = findManifestIdByHref(hrefToId, opfDir, pathPart);
			if (chapterId && title) {
				chapters.push({ id: chapterId, title, level });
			}
			walk(point, level + 1);
		}
	}

	walk(navMap ?? {}, 0);
	return chapters;
}

function chaptersFromSpine(
	spineIds: string[],
	manifest: Map<string, ManifestItem>,
): ReaderChapter[] {
	const chapters: ReaderChapter[] = [];
	for (const [index, id] of spineIds.entries()) {
		const item = manifest.get(id);
		if (!item) continue;
		const isHtml =
			item.mediaType.includes("html") ||
			item.href.endsWith(".xhtml") ||
			item.href.endsWith(".html");
		if (!isHtml) continue;
		chapters.push({
			id,
			title: `Chapter ${index + 1}`,
			level: 0,
		});
	}
	return chapters;
}

async function buildChapterList(archive: EpubArchive): Promise<ReaderChapter[]> {
	let chapters: ReaderChapter[] = [];

	const navItem = [...archive.manifest.values()].find((item) =>
		item.properties?.split(/\s+/).includes("nav"),
	);
	if (navItem) {
		chapters = await chaptersFromNavXhtml(
			archive.zip,
			navItem.href,
			archive.opfDir,
			archive.hrefToId,
		);
	}

	if (chapters.length === 0) {
		const ncxItem = [...archive.manifest.values()].find((item) =>
			item.mediaType.includes("ncx"),
		);
		if (ncxItem) {
			const ncxPath = resolveHref(archive.opfDir, ncxItem.href);
			const ncxXml = await readZipEntry(archive.zip, ncxPath);
			if (ncxXml) {
				chapters = chaptersFromNcx(ncxXml, archive.opfDir, archive.hrefToId);
			}
		}
	}

	if (chapters.length === 0) {
		chapters = chaptersFromSpine(archive.spineIds, archive.manifest);
	}

	return chapters;
}

async function loadParsedEpub(filePath: string): Promise<ParsedEpub | null> {
	const cached = epubCache.get(filePath);
	if (cached) return cached;

	const bytes = await readEpubFileBytes(filePath);
	if (!bytes) return null;

	const zip = await JSZip.loadAsync(bytes);

	const containerXml = await readZipEntry(zip, "META-INF/container.xml");
	if (!containerXml) return null;

	const container = xml.parse(containerXml) as Record<string, unknown>;
	const containerRoot =
		(container.container as Record<string, unknown> | undefined) ?? container;
	const rootfiles = containerRoot.rootfiles as
		| Record<string, unknown>
		| undefined;
	const rootfile = asRecordArray(rootfiles?.rootfile)[0];
	const opfPath = rootfile
		? String(rootfile["@_full-path"] ?? "").replace(/\\/g, "/")
		: "";
	if (!opfPath) return null;

	const opfXml = await readZipEntry(zip, opfPath);
	if (!opfXml) return null;

	const base = parseOpf(opfXml, opfPath);
	const archive: EpubArchive = { zip, ...base };
	const chapters = await buildChapterList(archive);

	const parsed: ParsedEpub = { ...archive, chapters };
	epubCache.set(filePath, parsed);
	return parsed;
}

export async function readEpubManifest(filePath: string): Promise<{
	title: string;
	chapters: ReaderChapter[];
} | null> {
	const parsed = await loadParsedEpub(filePath);
	if (!parsed) return null;
	if (parsed.chapters.length === 0) return null;
	return { title: parsed.title, chapters: parsed.chapters };
}

export async function readEpubChapterContent(
	filePath: string,
	chapterId: string,
): Promise<{ html: string; text: string } | null> {
	const parsed = await loadParsedEpub(filePath);
	if (!parsed) return null;
	const item = parsed.manifest.get(chapterId);
	if (!item) return null;
	const entryPath = resolveHref(parsed.opfDir, item.href);
	const raw = await readZipEntry(parsed.zip, entryPath);
	if (!raw) return null;
	const html = sanitizeEpubHtml(raw);
	return { html, text: htmlToPlainText(html) };
}

function guessImageMime(href: string): string {
	const ext = href.toLowerCase().split(".").pop() ?? "";
	if (ext === "png") return "image/png";
	if (ext === "gif") return "image/gif";
	if (ext === "webp") return "image/webp";
	if (ext === "svg") return "image/svg+xml";
	return "image/jpeg";
}

/** Best guess at the cover image manifest item (EPUB 3 props, EPUB 2 meta, then heuristic). */
function pickCoverItem(parsed: ParsedEpub): ManifestItem | null {
	for (const item of parsed.manifest.values()) {
		if (item.properties?.split(/\s+/).includes("cover-image")) return item;
	}
	if (parsed.coverId) {
		const item = parsed.manifest.get(parsed.coverId);
		if (item && (item.mediaType.startsWith("image/") || /\.(png|jpe?g|gif|webp)$/i.test(item.href))) {
			return item;
		}
	}
	for (const item of parsed.manifest.values()) {
		const isImage =
			item.mediaType.startsWith("image/") || /\.(png|jpe?g|gif|webp)$/i.test(item.href);
		if (isImage && /cover/i.test(`${item.id} ${item.href}`)) return item;
	}
	return null;
}

/** Raw cover image bytes + mime, or null if the EPUB has none we can find. */
export async function readEpubCoverBytes(
	filePath: string,
): Promise<{ data: Uint8Array; mime: string } | null> {
	const parsed = await loadParsedEpub(filePath);
	if (!parsed) return null;
	const item = pickCoverItem(parsed);
	if (!item) return null;
	const entry = parsed.zip.file(
		resolveHref(parsed.opfDir, item.href).replace(/^\//, ""),
	);
	if (!entry) return null;
	try {
		const data = await entry.async("uint8array");
		const mime = item.mediaType.startsWith("image/")
			? item.mediaType
			: guessImageMime(item.href);
		return { data, mime };
	} catch {
		return null;
	}
}

/** Cover image as a (full-size) data URL, or null if none. */
export async function readEpubCover(filePath: string): Promise<string | null> {
	const raw = await readEpubCoverBytes(filePath);
	if (!raw) return null;
	return `data:${raw.mime};base64,${Buffer.from(raw.data).toString("base64")}`;
}

export function clearEpubCache(filePath?: string): void {
	if (filePath) epubCache.delete(filePath);
	else epubCache.clear();
}
