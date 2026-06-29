/**
 * mid core — render a laid-out graph to an ASCII box-drawing grid.
 *
 * dagre coordinates are already ~char units (we size nodes in chars), so we map
 * 1 layout unit → 1 grid cell. Edges use simple down-horizontal-down routing
 * from node centers; labels are placed at dagre's per-edge label position so
 * sibling labels don't collide.
 *
 * `renderGrid` also reports each node's rectangle *in the final ASCII grid*
 * (row/col/width/height, after blank-row compression) so clients (e.g. the
 * Neovim plugin) can highlight a node by recoloring its cells — no re-render.
 */

import { type Layout, layout } from "./layout.ts";
import type { Graph, Span } from "./model.ts";
import { nodeHeight, nodeLines, nodeWidth } from "./text.ts";

export interface RenderOptions {
	selected?: string;
}

/** A node's bounding box in the emitted ASCII (0-indexed row, char column). */
export interface Cell {
	row: number;
	col: number;
	width: number;
	height: number;
}

export interface RenderResult {
	lines: string[];
	cells: Map<string, Cell>;
	/** each labeled edge's label rectangle in the grid, keyed `src\x00dst`. */
	edgeCells: Map<string, Cell>;
}

/** Key an edge by its endpoints (unique — edges are deduped by `(src,dst)`). */
const edgeKey = (src: string, dst: string): string => `${src}\x00${dst}`;

interface Box {
	top: number;
	left: number;
	centerCol: number;
	w: number;
	h: number; // total rows (text rows + 2 borders)
}

export function renderGrid(
	lay: Layout,
	opts: RenderOptions = {},
): RenderResult {
	if (lay.nodes.size === 0)
		return { lines: ["(empty graph)"], cells: new Map(), edgeCells: new Map() };

	// bounds over node boxes (variable height) and edge labels, so nothing clips
	let minX = Infinity;
	let minY = Infinity;
	for (const n of lay.nodes.values()) {
		minX = Math.min(minX, n.x - n.w / 2);
		minY = Math.min(minY, n.y - n.h / 2);
	}
	for (const e of lay.edges) {
		if (e.label && e.labelPos) {
			minX = Math.min(minX, e.labelPos.x - e.label.length / 2);
			minY = Math.min(minY, e.labelPos.y);
		}
	}
	const pad = 1;
	const toCol = (x: number) => Math.round(x - minX) + pad;
	const toRow = (y: number) => Math.round(y - minY) + pad;

	const boxes = new Map<string, Box>();
	for (const n of lay.nodes.values()) {
		const w = nodeWidth(n.name) + 4;
		const h = nodeHeight(n.name) + 2;
		const centerCol = toCol(n.x);
		boxes.set(n.name, {
			top: toRow(n.y) - Math.floor(h / 2),
			left: centerCol - Math.floor(w / 2),
			centerCol,
			w,
			h,
		});
	}

	let width = 0;
	let height = 0;
	for (const b of boxes.values()) {
		width = Math.max(width, b.left + b.w + pad);
		height = Math.max(height, b.top + b.h + pad);
	}
	for (const e of lay.edges) {
		if (e.label && e.labelPos) {
			width = Math.max(
				width,
				toCol(e.labelPos.x) + Math.ceil(e.label.length / 2) + pad,
			);
			height = Math.max(height, toRow(e.labelPos.y) + pad);
		}
	}

	const grid: string[][] = Array.from({ length: height }, () =>
		Array<string>(width).fill(" "),
	);
	const set = (r: number, c: number, ch: string) => {
		if (r >= 0 && r < height && c >= 0 && c < width) grid[r]![c] = ch;
	};
	const setBlank = (r: number, c: number, ch: string) => {
		if (r >= 0 && r < height && c >= 0 && c < width && grid[r]![c] === " ")
			grid[r]![c] = ch;
	};
	const draw = (r: number, c: number, text: string) => {
		for (let i = 0; i < text.length; i++) set(r, c + i, text[i]!);
	};

	// edges
	const labelBoxes = new Map<string, Cell>(); // uncompressed label rects, by edge key
	for (const e of lay.edges) {
		const s = boxes.get(e.src);
		const d = boxes.get(e.dst);
		if (!s || !d) continue;
		const sc = s.centerCol;
		const dc = d.centerCol;
		const startRow = s.top + s.h;
		const endRow = d.top - 1;

		if (Math.abs(sc - dc) <= 1) {
			for (let r = startRow; r <= endRow; r++) setBlank(r, sc, "│");
		} else {
			const mid = startRow + 1;
			for (let r = startRow; r <= mid; r++) setBlank(r, sc, "│");
			set(mid, sc, dc > sc ? "╰" : "╯");
			set(mid, dc, dc > sc ? "╮" : "╭");
			const left = Math.min(sc, dc) + 1;
			const right = Math.max(sc, dc);
			for (let c = left; c < right; c++) setBlank(mid, c, "─");
			for (let r = mid + 1; r <= endRow; r++) setBlank(r, dc, "│");
		}

		if (e.label && e.labelPos) {
			const lr = toRow(e.labelPos.y);
			const lc = toCol(e.labelPos.x) - Math.floor(e.label.length / 2);
			draw(lr, lc, e.label);
			labelBoxes.set(edgeKey(e.src, e.dst), {
				row: lr,
				col: lc,
				width: e.label.length,
				height: 1,
			});
		}
	}

	// nodes
	for (const [name, b] of boxes) {
		const sel = name === opts.selected;
		const [tl, tr, bl, br, h, v] = sel
			? ["┏", "┓", "┗", "┛", "━", "┃"]
			: ["╭", "╮", "╰", "╯", "─", "│"];
		const inner = b.w - 4; // text area between "│ " and " │"
		const rows = nodeLines(name);
		draw(b.top, b.left, tl + h.repeat(b.w - 2) + tr);
		for (let i = 0; i < rows.length; i++) {
			const t = rows[i]!;
			const padL = Math.floor((inner - t.length) / 2); // center each row
			const padR = inner - t.length - padL;
			draw(
				b.top + 1 + i,
				b.left,
				`${v} ${" ".repeat(padL)}${t}${" ".repeat(padR)} ${v}`,
			);
		}
		draw(b.top + b.h - 1, b.left, bl + h.repeat(b.w - 2) + br);
	}

	const { grid: compressed, rowMap } = compress(grid);

	// map each node box to its row in the compressed grid
	const cells = new Map<string, Cell>();
	for (const [name, b] of boxes) {
		const row = rowMap[b.top];
		if (row !== undefined && row >= 0) {
			cells.set(name, { row, col: b.left, width: b.w, height: b.h });
		}
	}

	// map each edge label box through the same row compression (the label row has
	// letters, so it survives `compress`)
	const edgeCells = new Map<string, Cell>();
	for (const [key, b] of labelBoxes) {
		const row = rowMap[b.row];
		if (row !== undefined && row >= 0) {
			edgeCells.set(key, { row, col: b.col, width: b.width, height: b.height });
		}
	}

	const lines = compressed.map((row) => row.join("").replace(/\s+$/, ""));
	while (lines.length && lines[lines.length - 1] === "") lines.pop();

	return { lines, cells, edgeCells };
}

/** Collapse runs of blank rows to one; returns the new grid and old→new row map. */
function compress(grid: string[][]): { grid: string[][]; rowMap: number[] } {
	const keep = new Set("╭╮╰╯┏┓┗┛─━");
	const out: string[][] = [];
	const rowMap = new Array<number>(grid.length).fill(-1);
	let blanks = 0;
	for (let r = 0; r < grid.length; r++) {
		const row = grid[r]!;
		const hasContent = row.some((ch) => keep.has(ch) || /[A-Za-z0-9]/.test(ch));
		if (hasContent) {
			blanks = 0;
			rowMap[r] = out.length;
			out.push(row);
		} else if (blanks === 0) {
			blanks = 1;
			rowMap[r] = out.length;
			out.push(row);
		}
	}
	return { grid: out, rowMap };
}

export function renderAscii(lay: Layout, opts: RenderOptions = {}): string {
	return renderGrid(lay, opts).lines.join("\n");
}

/**
 * The contract consumed by the Neovim client. Per node: its `name`, source `spans`
 * (spans[0] is primary), and its `cell` rectangle in the ASCII grid. Per edge:
 * `src`/`dst`/`label`, the label's source `spans`, and the label's `cell` (present
 * only for labeled edges — an unlabeled edge has no token to highlight). Plus the
 * joined `ascii`. (Obsidian imports the core directly and renders Mermaid SVG, so it
 * doesn't use this.)
 */
export interface GraphJSON {
	nodes: Array<{
		name: string;
		/** every place this node's name appears in the source; spans[0] is primary. */
		spans: Span[];
		/** the node's rectangle in the emitted ASCII grid (for client-side highlight). */
		cell?: Cell;
	}>;
	edges: Array<{
		src: string;
		dst: string;
		label?: string;
		/** where the edge's label token appears in the source (empty if unlabeled). */
		spans: Span[];
		/** the label's rectangle in the ASCII grid (present only for labeled edges). */
		cell?: Cell;
	}>;
	ascii: string;
}

export function toJSON(
	graph: Graph,
	lay: Layout,
	opts: RenderOptions = {},
): GraphJSON {
	const { lines, cells, edgeCells } = renderGrid(lay, opts);
	const spansByEdge = new Map(
		graph.edges.map((e) => [`${e.src}\x00${e.dst}`, e.spans]),
	);
	return {
		nodes: [...lay.nodes.values()].map((n) => ({
			name: n.name,
			spans: graph.nodes.get(n.name)?.spans ?? [],
			cell: cells.get(n.name),
		})),
		edges: lay.edges.map((e) => ({
			src: e.src,
			dst: e.dst,
			label: e.label,
			spans: spansByEdge.get(`${e.src}\x00${e.dst}`) ?? [],
			cell: edgeCells.get(`${e.src}\x00${e.dst}`),
		})),
		ascii: lines.join("\n"),
	};
}

/** Convenience: graph → laid out → ASCII. */
export function render(graph: Graph, opts: RenderOptions = {}): string {
	return renderAscii(layout(graph), opts);
}
