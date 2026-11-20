import type { Graph } from "@fungi.computer/braid";
import { displayEdges } from "../editor/graph-presentation.js";

const card = { width: 90, height: 44 };
const margin = 24;

/** One dot colour per kind of step, so a template reads at a glance. */
const kindColour = new Map([
  ["app", "var(--color-primary)"],
  ["code", "var(--color-secondary)"],
  ["condition", "var(--color-accent)"],
  ["map", "var(--color-info)"],
  ["review", "var(--color-warning)"],
]);

/**
 * A template's graph as a read-only picture: each step a small card where its
 * layout puts it, each wire a line. Nothing here is interactive; Use opens the
 * real canvas.
 */
export function MiniCanvas({
  graph,
  layout,
  label,
}: {
  graph: Graph;
  layout: Readonly<Record<string, { x: number; y: number }>>;
  label: string;
}) {
  const nodes = graph.nodes.flatMap((node) =>
    Object.hasOwn(layout, node.id) ? [{ node, at: layout[node.id] }] : [],
  );
  if (nodes.length === 0) return <div className="wf-mini-canvas" />;
  const xs = nodes.map(({ at }) => at.x);
  const ys = nodes.map(({ at }) => at.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const spanX = Math.max(...xs) - minX;
  const spanY = Math.max(...ys) - minY;
  // One scale for both axes keeps the cards the same shape in every template.
  const scale = Math.min(
    1,
    spanX === 0 ? 1 : (400 - 2 * margin - card.width) / spanX,
    spanY === 0 ? 1 : (110 - 2 * margin - card.height) / spanY,
  );
  const place = (id: string) => {
    if (!Object.hasOwn(layout, id)) return undefined;
    const at = layout[id];
    return {
      x: margin + (at.x - minX) * scale,
      y: 55 - card.height / 2 + (at.y - minY - spanY / 2) * scale,
    };
  };
  const drawn = new Set(nodes.map(({ node }) => node.id));
  // A wire from the workflow input or to its output has no card to join.
  const wires = displayEdges(graph).flatMap((edge) => {
    const from = drawn.has(edge.from.node) ? place(edge.from.node) : undefined;
    const to = drawn.has(edge.to.node) ? place(edge.to.node) : undefined;
    return from && to ? [{ from, to, key: edge.id }] : [];
  });
  return (
    <svg
      className="wf-mini-canvas"
      viewBox="0 0 400 110"
      role="img"
      aria-label={label}
    >
      {wires.map(({ from, to, key }) => (
        <path
          key={key}
          d={`M ${String(from.x + card.width)} ${String(from.y + card.height / 2)} C ${String(from.x + card.width + 16)} ${String(from.y + card.height / 2)}, ${String(to.x - 16)} ${String(to.y + card.height / 2)}, ${String(to.x)} ${String(to.y + card.height / 2)}`}
          fill="none"
          stroke="currentColor"
          strokeOpacity="0.45"
          strokeWidth="1.5"
        />
      ))}
      {nodes.map(({ node }) => {
        const at = place(node.id);
        if (!at) return null;
        return (
          <g key={node.id}>
            <rect
              x={at.x}
              y={at.y}
              width={card.width}
              height={card.height}
              rx="8"
              fill="var(--color-base-100)"
              stroke="currentColor"
              strokeOpacity="0.5"
            />
            <circle
              cx={at.x + 14}
              cy={at.y + card.height / 2}
              r="5"
              fill={kindColour.get(node.kind) ?? "currentColor"}
            />
          </g>
        );
      })}
    </svg>
  );
}
