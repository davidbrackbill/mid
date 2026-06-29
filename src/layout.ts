/**
 * mid core — layered layout via dagre (the JS Sugiyama).
 *
 * Node sizes are expressed in character units (box width = text width + 4,
 * height = text rows + 2), so dagre's coordinates come back roughly in grid space
 * and the renderer can map them directly. A name with literal `\n`s is multiple
 * rows tall. dagre's (x, y) are node *centers*.
 */
import dagre from "@dagrejs/dagre";
import type { Graph } from "./model.ts";
import { nodeHeight, nodeWidth } from "./text.ts";

export interface LaidOutNode {
	name: string;
	x: number; // center
	y: number;
	w: number;
	h: number;
}

export interface Point {
	x: number;
	y: number;
}

export interface LaidOutEdge {
	src: string;
	dst: string;
	label?: string;
	labelPos?: Point; // dagre's edge-label center (the renderer places labels here)
}

export interface Layout {
	nodes: Map<string, LaidOutNode>;
	edges: LaidOutEdge[];
}

export function layout(graph: Graph): Layout {
	const g = new dagre.graphlib.Graph();
	g.setGraph({
		rankdir: "TB",
		nodesep: 4,
		ranksep: 4,
		edgesep: 2,
		marginx: 1,
		marginy: 1,
	});
	g.setDefaultEdgeLabel(() => ({}));

	for (const n of graph.nodes.values()) {
		// char units: a box is `│ text │` (width = text + 4) by (rows + 2 borders).
		// A name with literal `\n`s is several rows tall and as wide as its widest row.
		g.setNode(n.name, {
			width: nodeWidth(n.name) + 4,
			height: nodeHeight(n.name) + 2,
		});
	}
	for (const e of graph.edges) {
		const lbl = e.label ?? "";
		g.setEdge(
			e.src,
			e.dst,
			lbl ? { label: lbl, width: lbl.length, height: 1, labelpos: "c" } : {},
		);
	}

	dagre.layout(g);

	const nodes = new Map<string, LaidOutNode>();
	for (const name of g.nodes()) {
		const d = g.node(name) as {
			x: number;
			y: number;
			width: number;
			height: number;
		};
		nodes.set(name, { name, x: d.x, y: d.y, w: d.width, h: d.height });
	}

	const edges: LaidOutEdge[] = [];
	for (const e of g.edges()) {
		const d = g.edge(e) as { label?: string; x?: number; y?: number };
		edges.push({
			src: e.v,
			dst: e.w,
			label: d.label || undefined,
			labelPos:
				d.x !== undefined && d.y !== undefined ? { x: d.x, y: d.y } : undefined,
		});
	}

	return { nodes, edges };
}
