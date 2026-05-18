const SCROLL_EDGE_PADDING_PX = 12;

function getScrollableViewport(el: HTMLElement): HTMLElement | null {
	const radix = el.closest<HTMLElement>("[data-radix-scroll-area-viewport]");
	if (radix) return radix;
	let node: HTMLElement | null = el.parentElement;
	while (node) {
		const { overflowY } = getComputedStyle(node);
		if (
			(overflowY === "auto" || overflowY === "scroll" || overflowY === "overlay") &&
			node.scrollHeight > node.clientHeight
		) {
			return node;
		}
		node = node.parentElement;
	}
	return null;
}

/** Scroll the nearest reader viewport so `el` is fully visible. */
export function scrollElementFullyVisible(
	el: HTMLElement,
	padding = SCROLL_EDGE_PADDING_PX,
) {
	const root = getScrollableViewport(el);
	if (!root) {
		el.scrollIntoView({ block: "nearest", inline: "nearest" });
		return;
	}
	const er = el.getBoundingClientRect();
	const rr = root.getBoundingClientRect();
	const elTop = root.scrollTop + (er.top - rr.top);
	const elBottom = elTop + er.height;
	const viewH = root.clientHeight;
	let top = root.scrollTop;

	if (elTop < top + padding) {
		top = elTop - padding;
	}
	if (elBottom > top + viewH - padding) {
		top = elBottom - viewH + padding;
	}
	if (elTop < top + padding) {
		top = elTop - padding;
	}

	const maxScroll = Math.max(0, root.scrollHeight - viewH);
	root.scrollTop = Math.min(maxScroll, Math.max(0, top));
}
