import { describe, expect, it } from "bun:test";
import {
	collapseWhitespace,
	dictionaryApiUrl,
	extractLookupWord,
	isSingleWordSelection,
	parseDictionaryResponse,
	truncateMenuLabel,
	wiktionaryUrl,
} from "./dictionary";

/** Mock of a real dictionaryapi.dev payload for "hello" (trimmed). */
const HELLO_RESPONSE = [
	{
		word: "hello",
		phonetic: "/həˈləʊ/",
		phonetics: [
			{ text: "/həˈləʊ/", audio: "" },
			{
				text: "/həˈloʊ/",
				audio:
					"https://api.dictionaryapi.dev/media/pronunciations/en/hello-us.mp3",
				sourceUrl: "https://commons.wikimedia.org/w/index.php?curid=9021983",
			},
		],
		meanings: [
			{
				partOfSpeech: "noun",
				definitions: [
					{
						definition: '"Hello!" or an equivalent greeting.',
						synonyms: ["greeting"],
						antonyms: [],
					},
				],
				synonyms: ["greeting"],
				antonyms: [],
			},
			{
				partOfSpeech: "interjection",
				definitions: [
					{
						definition: "A greeting used when answering the telephone.",
						synonyms: [],
						antonyms: [],
						example: "Hello? How may I help you?",
					},
					{
						definition:
							"A call for response if it is not clear if anyone is present or listening.",
						synonyms: [],
						antonyms: [],
						example: "Hello? Is anyone there?",
					},
					{ definition: "Used sarcastically.", synonyms: [], antonyms: [] },
					{
						definition: "An expression of puzzlement or discovery.",
						synonyms: [],
						antonyms: [],
						example: "Hello! What’s going on here?",
					},
				],
				synonyms: [],
				antonyms: [],
			},
		],
		license: { name: "CC BY-SA 3.0", url: "https://creativecommons.org/licenses/by-sa/3.0" },
		sourceUrls: ["https://en.wiktionary.org/wiki/hello"],
	},
];

/** Mock of the API's 404 body ("No Definitions Found"). */
const NOT_FOUND_RESPONSE = {
	title: "No Definitions Found",
	message:
		"Sorry pal, we couldn't find definitions for the word you were looking for.",
	resolution:
		"You can try the search again at later time or head to the web instead.",
};

describe("parseDictionaryResponse", () => {
	it("parses word, phonetics and meanings from a realistic payload", () => {
		const entries = parseDictionaryResponse(HELLO_RESPONSE);
		expect(entries).toHaveLength(1);
		const entry = entries[0]!;
		expect(entry.word).toBe("hello");
		// Empty-audio phonetic keeps its IPA text; audio variant keeps both.
		expect(entry.phonetics).toEqual([
			{ text: "/həˈləʊ/", audioUrl: null },
			{
				text: "/həˈloʊ/",
				audioUrl:
					"https://api.dictionaryapi.dev/media/pronunciations/en/hello-us.mp3",
			},
		]);
		expect(entry.meanings).toHaveLength(2);
		expect(entry.meanings[0]!.partOfSpeech).toBe("noun");
		expect(entry.meanings[0]!.definitions[0]!.example).toBeNull();
	});

	it("caps definitions per meaning at 3", () => {
		const entries = parseDictionaryResponse(HELLO_RESPONSE);
		const interjection = entries[0]!.meanings[1]!;
		expect(interjection.definitions).toHaveLength(3);
		expect(interjection.definitions[0]!.example).toBe(
			"Hello? How may I help you?",
		);
	});

	it("returns [] for the API's not-found object", () => {
		expect(parseDictionaryResponse(NOT_FOUND_RESPONSE)).toEqual([]);
	});

	it("returns [] for malformed payloads", () => {
		expect(parseDictionaryResponse(null)).toEqual([]);
		expect(parseDictionaryResponse("oops")).toEqual([]);
		expect(parseDictionaryResponse([null, 42, "x"])).toEqual([]);
		expect(parseDictionaryResponse([{ word: "x" }])).toEqual([]);
		expect(
			parseDictionaryResponse([{ word: "x", meanings: [{ definitions: [] }] }]),
		).toEqual([]);
	});

	it("normalizes protocol-relative audio URLs and drops http/empty ones", () => {
		const entries = parseDictionaryResponse([
			{
				word: "hej",
				phonetics: [
					{ text: "/hɛj/", audio: "//ssl.gstatic.com/dictionary/hej.mp3" },
					{ audio: "http://insecure.example/x.mp3" },
					{ audio: "" },
				],
				meanings: [
					{ partOfSpeech: "interjection", definitions: [{ definition: "hi" }] },
				],
			},
		]);
		expect(entries[0]!.phonetics).toEqual([
			{
				text: "/hɛj/",
				audioUrl: "https://ssl.gstatic.com/dictionary/hej.mp3",
			},
		]);
	});

	it("dedupes identical phonetic variants", () => {
		const entries = parseDictionaryResponse([
			{
				word: "twin",
				phonetics: [{ text: "/twɪn/" }, { text: "/twɪn/", audio: "" }],
				meanings: [
					{ partOfSpeech: "noun", definitions: [{ definition: "one of two" }] },
				],
			},
		]);
		expect(entries[0]!.phonetics).toEqual([{ text: "/twɪn/", audioUrl: null }]);
	});
});

describe("extractLookupWord", () => {
	it("returns the single selected word", () => {
		expect(extractLookupWord("serendipity")).toBe("serendipity");
	});

	it("takes the first word of a multi-word selection", () => {
		expect(extractLookupWord("quick brown fox")).toBe("quick");
		expect(extractLookupWord("  spaced\n out ")).toBe("spaced");
	});

	it("strips surrounding punctuation and quotes but keeps inner marks", () => {
		expect(extractLookupWord('"hello,"')).toBe("hello");
		expect(extractLookupWord("(don't)")).toBe("don't");
		expect(extractLookupWord("mother-in-law.")).toBe("mother-in-law");
		expect(extractLookupWord("“curly”")).toBe("curly");
	});

	it("returns null for empty or letterless selections", () => {
		expect(extractLookupWord("")).toBeNull();
		expect(extractLookupWord(null)).toBeNull();
		expect(extractLookupWord(undefined)).toBeNull();
		expect(extractLookupWord("   ")).toBeNull();
		expect(extractLookupWord("123")).toBeNull();
		expect(extractLookupWord("—…!?")).toBeNull();
	});

	it("rejects absurdly long tokens", () => {
		expect(extractLookupWord("a".repeat(65))).toBeNull();
		expect(extractLookupWord("a".repeat(64))).toBe("a".repeat(64));
	});
});

describe("isSingleWordSelection", () => {
	it("is true only for one-word selections", () => {
		expect(isSingleWordSelection("hello")).toBe(true);
		expect(isSingleWordSelection(' "hello." ')).toBe(true);
		expect(isSingleWordSelection("hello there")).toBe(false);
		expect(isSingleWordSelection("")).toBe(false);
		expect(isSingleWordSelection("42")).toBe(false);
	});
});

describe("truncateMenuLabel", () => {
	it("returns short selections unchanged (single-lined)", () => {
		expect(truncateMenuLabel("hello world")).toBe("hello world");
		expect(truncateMenuLabel("line\nbreak")).toBe("line break");
	});

	it("truncates long selections with an ellipsis at ~24 chars", () => {
		const label = truncateMenuLabel(
			"the quick brown fox jumps over the lazy dog",
		);
		expect(label.length).toBeLessThanOrEqual(24);
		expect(label.endsWith("…")).toBe(true);
		expect(label).toBe("the quick brown fox jum…");
	});

	it("does not leave a trailing space before the ellipsis", () => {
		expect(truncateMenuLabel("twelve chars exactly ok!!", 22)).toBe(
			"twelve chars exactly…",
		);
	});
});

describe("collapseWhitespace", () => {
	it("collapses runs of whitespace including newlines", () => {
		expect(collapseWhitespace("  a\n\n b\tc  ")).toBe("a b c");
	});
});

describe("urls", () => {
	it("encodes the word into API and Wiktionary URLs", () => {
		expect(dictionaryApiUrl("naïve")).toBe(
			"https://api.dictionaryapi.dev/api/v2/entries/en/na%C3%AFve",
		);
		expect(wiktionaryUrl("don't")).toBe(
			"https://en.wiktionary.org/wiki/don't",
		);
	});
});
