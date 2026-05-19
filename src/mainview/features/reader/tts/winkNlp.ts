import winkNLP from "wink-nlp";
import winkModel from "wink-eng-lite-web-model";

type WinkNlp = ReturnType<typeof winkNLP>;

let nlp: WinkNlp | null = null;

/** Lazy singleton — model is ~2–3 MB, loaded on first chunk build. */
export function getWinkNlp(): WinkNlp {
	if (!nlp) nlp = winkNLP(winkModel);
	return nlp;
}

export type TokenCharBounds = {
	starts: number[];
	ends: number[];
};

/** Maps each token index to inclusive-exclusive char offsets in the `readDoc` input. */
export function tokenCharBounds(
	doc: ReturnType<WinkNlp["readDoc"]>,
): TokenCharBounds {
	const its = getWinkNlp().its;
	const starts: number[] = [];
	const ends: number[] = [];
	let pos = 0;
	doc.tokens().each((t: { out: (f?: unknown) => unknown }) => {
		pos += String(t.out(its.precedingSpaces)).length;
		starts.push(pos);
		pos += String(t.out()).length;
		ends.push(pos);
	});
	return { starts, ends };
}
