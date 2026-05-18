import type { LoadedDocument } from "../types";

/** Demo payload so the empty state can preview the reader without a real file. */
export const SAMPLE_TXT_DOCUMENT: Extract<LoadedDocument, { format: "txt" }> = {
	format: "txt",
	fileName: "the-great-gatsby.txt",
	chapters: [
		{ id: "gatsby-1", title: "Chapter I", level: 0 },
		{ id: "gatsby-1a", title: "Opening reflection", level: 1 },
		{ id: "gatsby-2", title: "The advice", level: 0 },
		{ id: "gatsby-3", title: "Reserved communicators", level: 0 },
	],
	text: `In my younger and more vulnerable years my father gave me some advice that I've been turning over in my mind ever since.

"Whenever you feel like criticizing any one," he told me, "just remember that all the people in this world haven't had the advantages that you've had."

He didn't say any more, but we've always been unusually communicative in a reserved way, and I understood that he meant a great deal more than that. In consequence, I'm inclined to reserve all judgements, a habit that has opened up many curious natures to me and also made me the victim of not a few veteran bores.`,
};
