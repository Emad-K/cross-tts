import { useEffect } from "react";
import { useAppSettingsStore } from "../settings/appSettingsStore";
import { useSweepStore } from "../tts/sweepStore";
import { useTtsStore } from "../tts/ttsStore";
import {
	type TimedWord,
	wordIndexAtProgress,
	wordTimeline,
} from "../tts/wordTiming";
import "./wordHighlight.css";

const HIGHLIGHT_NAME = "tts-word";

type ChunkText = {
	index: number;
	/** The chunk's text nodes in order, with each one's offset in the chunk. */
	nodes: { node: Text; start: number }[];
	words: TimedWord[];
};

/** Text nodes of chunk `index` as rendered (an EPUB chunk can span elements). */
function readChunkText(index: number): ChunkText | null {
	const nodes: ChunkText["nodes"] = [];
	let text = "";
	for (const el of document.querySelectorAll(`[data-chunk-index="${index}"]`)) {
		const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
		for (let n = walker.nextNode(); n; n = walker.nextNode()) {
			nodes.push({ node: n as Text, start: text.length });
			text += (n as Text).data;
		}
	}
	return nodes.length > 0 ? { index, nodes, words: wordTimeline(text) } : null;
}

function boundary(chunk: ChunkText, offset: number): [Text, number] {
	let at = chunk.nodes[0]!;
	for (const n of chunk.nodes) {
		if (n.start > offset) break;
		at = n;
	}
	return [at.node, Math.min(at.node.length, offset - at.start)];
}

/**
 * Follow playback with a highlight on the word being spoken. Driven by the
 * same audio-clock sweep as the sentence highlight; the page is touched only
 * when the word changes (one Range in the highlight registry, no React
 * render). Returns a stop function.
 */
function startWordHighlight(): () => void {
	if (typeof CSS === "undefined" || !("highlights" in CSS)) return () => {};
	let chunk: ChunkText | null = null;
	let shown = -1;

	const clear = () => {
		if (shown !== -1) CSS.highlights.delete(HIGHLIGHT_NAME);
		shown = -1;
	};

	const update = () => {
		const { playback, currentChunkIndex } = useTtsStore.getState();
		if (playback !== "playing" && playback !== "paused") return clear();
		if (
			chunk?.index !== currentChunkIndex ||
			!chunk.nodes.every((n) => n.node.isConnected)
		) {
			clear();
			chunk = readChunkText(currentChunkIndex);
		}
		if (!chunk) return;
		const i = wordIndexAtProgress(chunk.words, useSweepStore.getState().progress);
		if (i === shown) return;
		const word = chunk.words[i];
		if (!word) return clear();
		const range = new Range();
		range.setStart(...boundary(chunk, word.start));
		range.setEnd(...boundary(chunk, word.end));
		CSS.highlights.set(HIGHLIGHT_NAME, new Highlight(range));
		shown = i;
	};

	const stops = [useSweepStore.subscribe(update), useTtsStore.subscribe(update)];
	return () => {
		for (const stop of stops) stop();
		clear();
	};
}

/** Run the word highlight while the "Highlight: Word" setting is on. */
export function useWordHighlight(): void {
	const on = useAppSettingsStore(
		(s) => s.config?.appearance.highlightMode === "word",
	);
	useEffect(() => (on ? startWordHighlight() : undefined), [on]);
}
