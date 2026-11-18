import type { Graph } from "@fungi.computer/braid";
import { displayEdges } from "./graph-presentation.js";

export type Direction = "LR" | "TB";

/** The one choice for how a workflow reads. Left to right is the picked variant. */
const direction: Direction = "LR";

/** Which side of a card its input and output pins sit on. */
export function handleSides(dir: Direction = direction) {
  return dir === "LR"
    ? ({ input: "left", output: "right" } as const)
    : ({ input: "top", output: "bottom" } as const);
}

export type Point = { readonly x: number; readonly y: number };
export type Size = { readonly width: number; readonly height: number };

/** A card is 14rem wide, so six columns still read at 1440; the gaps leave room for wires. */
export const cardSize: Size = { width: 224, height: 150 };
const gap = { across: 32, along: 32 } as const;
const margin = 40;

/**
 * Dependency depth: the input is depth 0, and a step sits one column past the
 * deepest step it reads from. A cycle (an invalid draft) stops at the step
 * already being placed rather than looping.
 */
export function dependencyDepths(graph: Graph) {
  const reads = new Map<string, Set<string>>();
  for (const edge of displayEdges(graph)) {
    const sources = reads.get(edge.to.node) ?? new Set<string>();
    sources.add(edge.from.node);
    reads.set(edge.to.node, sources);
  }
  const depths = new Map<string, number>([["$input", 0]]);
  const place = (id: string, path: ReadonlySet<string>): number => {
    const known = depths.get(id);
    if (known !== undefined) return known;
    const sources = [...(reads.get(id) ?? [])].filter(
      (source) => source !== id && !path.has(source),
    );
    const depth =
      1 +
      Math.max(
        0,
        ...sources.map((source) => place(source, new Set([...path, id]))),
      );
    depths.set(id, depth);
    return depth;
  };
  for (const node of graph.nodes) place(node.id, new Set());
  return depths;
}

/**
 * Positions for every card: a saved position stays where the person put it, and
 * each unplaced card goes in the column of its dependency depth, stacked
 * after the cards already in that column. Sizes come from measured cards.
 */
export function placeNodes(
  graph: Graph,
  saved: Readonly<Record<string, Point>>,
  sizes: Readonly<Partial<Record<string, Size>>> = {},
  dir: Direction = direction,
): ReadonlyMap<string, Point> {
  const depths = dependencyDepths(graph);
  const ids = ["$input", ...graph.nodes.map((node) => node.id)];
  const placed = new Map<string, Point>();
  const used = new Map<number, number>();
  const size = (id: string) => sizes[id] ?? cardSize;
  const horizontal = dir === "LR";
  const alongOf = (id: string) =>
    horizontal ? size(id).height : size(id).width;
  const acrossOf = (id: string) =>
    horizontal ? size(id).width : size(id).height;
  const column = (id: string) => depths.get(id) ?? 0;
  const columnStart = new Map<number, number>();
  const columns = [...new Set(ids.map(column))].sort((a, b) => a - b);
  let offset = margin;
  for (const depth of columns) {
    columnStart.set(depth, offset);
    offset +=
      Math.max(...ids.filter((id) => column(id) === depth).map(acrossOf)) +
      gap.across;
  }
  for (const id of ids) {
    if (Object.hasOwn(saved, id)) {
      placed.set(id, saved[id]);
      continue;
    }
    const depth = column(id);
    const along = used.get(depth) ?? margin;
    used.set(depth, along + alongOf(id) + gap.along);
    const across = columnStart.get(depth) ?? margin;
    placed.set(
      id,
      horizontal ? { x: across, y: along } : { x: along, y: across },
    );
  }
  return placed;
}
