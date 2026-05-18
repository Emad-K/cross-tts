import { readFileSync } from "node:fs";
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

type ParsedEpub = {
	zip: JSZip;
	opfDir: string;
	title: string;
	manifest: Map<string, ManifestItem>;
	spineIds: string[];
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
	const combined = normalize(join(opfDir, decodeURIComponent(href))).replace(/\\/g, "/");
	return combined.startsWith("/") ? combined.slice(1) : combined;
}

async function readZipEntry(zip: JSZip, path: string): Promise<string | null> {
	const entry = zip.file(path.replace(/^\//, ""));
	if (!entry) return null;
	return entry.async("string");
}

function parseOpf(opfXml: string, opfPath: string): Omit<ParsedEpub, "zip"> {
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

	return { opfDir, title, manifest, spineIds, chapters: [] };
}

function chaptersFromNavOl(
	ol: Record<string, unknown> | undefined,
	opfDir: string,
	manifest: Map<string, ManifestItem>,
	level: number,
	out: ReaderChapter[],
): void {
	for (const li of asRecordArray(ol?.li)) {
		const anchor = li.a as Record<string, unknown> | undefined;
		const hrefRaw = anchor ? String(anchor["@_href"] ?? "") : "";
		const title = anchor ? textContent(anchor) : textContent(li);
		const [pathPart] = hrefRaw.split("#");
		const chapterId = findManifestIdByHref(manifest, opfDir, pathPart);
		if (chapterId && title) {
			out.push({ id: chapterId, title, level });
		}
		const nested = li.ol as Record<string, unknown> | undefined;
		if (nested) {
			chaptersFromNavOl(nested, opfDir, manifest, level + 1, out);
		}
	}
}

function findManifestIdByHref(
	manifest: Map<string, ManifestItem>,
	opfDir: string,
	hrefPart: string,
): string | null {
	if (!hrefPart) return null;
	const target = resolveHref(opfDir, hrefPart);
	for (const [id, item] of manifest) {
		if (resolveHref(opfDir, item.href) === target) return id;
	}
	return null;
}

async function chaptersFromNavXhtml(
	zip: JSZip,
	navHref: string,
	opfDir: string,
	manifest: Map<string, ManifestItem>,
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
	chaptersFromNavOl(ol, opfDir, manifest, 0, chapters);
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
	manifest: Map<string, ManifestItem>,
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
			const chapterId = findManifestIdByHref(manifest, opfDir, pathPart);
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

async function loadParsedEpub(filePath: string): Promise<ParsedEpub | null> {
	const cached = epubCache.get(filePath);
	if (cached) return cached;

	const buffer = readFileSync(filePath);
	const zip = await JSZip.loadAsync(new Uint8Array(buffer));

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
	let chapters: ReaderChapter[] = [];

	const navItem = [...base.manifest.values()].find((item) =>
		item.properties?.split(/\s+/).includes("nav"),
	);
	if (navItem) {
		chapters = await chaptersFromNavXhtml(
			zip,
			navItem.href,
			base.opfDir,
			base.manifest,
		);
	}

	if (chapters.length === 0) {
		const ncxItem = [...base.manifest.values()].find((item) =>
			item.mediaType.includes("ncx"),
		);
		if (ncxItem) {
			const ncxPath = resolveHref(base.opfDir, ncxItem.href);
			const ncxXml = await readZipEntry(zip, ncxPath);
			if (ncxXml) {
				chapters = chaptersFromNcx(ncxXml, base.opfDir, base.manifest);
			}
		}
	}

	if (chapters.length === 0) {
		chapters = chaptersFromSpine(base.spineIds, base.manifest);
	}

	const parsed: ParsedEpub = { zip, ...base, chapters };
	epubCache.set(filePath, parsed);
	return parsed;
}

export async function readEpubManifest(filePath: string): Promise<{
	title: string;
	chapters: ReaderChapter[];
} | null> {
	const parsed = await loadParsedEpub(filePath);
	if (!parsed?.chapters.length) return null;
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

export function clearEpubCache(filePath?: string): void {
	if (filePath) epubCache.delete(filePath);
	else epubCache.clear();
}
