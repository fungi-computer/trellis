import { useState } from "react";
import type { Catalog, Issue } from "@fungi.computer/braid";
import type { Draft, DraftDocument } from "./draft-store.js";
import { graphDraft, replaceGraphDraft } from "./graph-address.js";
import { nodePresentation } from "./graph-presentation.js";

/** The loop whose body is graphId, and the graph that loop sits in. */
function loopOf(draft: Draft, graphId: string) {
  const graphs = [
    ["root", draft.definition.nodes] as const,
    ...Object.entries(draft.definition.subgraphs ?? {}).map(
      ([id, graph]) => [id, graph.nodes] as const,
    ),
  ];
  for (const [parent, nodes] of graphs) {
    const node = nodes.find(
      (item) =>
        (item.kind === "map" || item.kind === "repeat") &&
        item.body === graphId,
    );
    if (node) return { node, parent };
  }
  return undefined;
}

/** The graph a person entered; "root" is the workflow itself. Call it before any early return. */
export function useEnteredGraph(initial = "root") {
  const [entered, setEntered] = useState(initial);
  return { entered, enter: setEntered };
}

/**
 * The graph the canvas shows: the workflow itself, or the body of a loop a
 * person entered, laid out by its own positions. A body that is gone (another
 * version, an undo) falls back to the workflow. parent is where Back goes: the
 * graph the loop sits in, which is another body for a loop inside a loop.
 */
export function enteredView(
  draft: Draft,
  entered: string,
  catalog: Catalog,
  appDisplay: DraftDocument["appDisplay"],
) {
  const inner = entered === "root" ? undefined : loopOf(draft, entered);
  const titles: string[] = [];
  const depth = Object.keys(draft.definition.subgraphs ?? {}).length;
  let at = inner;
  for (let step = 0; at && step <= depth; step += 1) {
    titles.unshift(
      nodePresentation(draft.definition, catalog, at.node, appDisplay).title,
    );
    at = at.parent === "root" ? undefined : loopOf(draft, at.parent);
  }
  const graphId = inner ? entered : "root";
  return {
    graphId,
    scoped: graphDraft(draft, graphId) ?? draft,
    parent: inner?.parent ?? "root",
    /** The loops a person went through to get here, outermost first. */
    crumb: titles.length ? titles.join(" › ") : undefined,
  };
}

/** The issues of the graph on show; the workflow's list also carries its loops' bodies. */
export function issuesOfGraph(issues: readonly Issue[], graphId: string) {
  return graphId === "root"
    ? issues
    : issues.filter((issue) => issue.graph === graphId);
}

/** A step moved in graphId; a body step's position lands under "<graphId>/<id>". */
export function moveStep(
  draft: Draft,
  graphId: string,
  id: string,
  position: { x: number; y: number },
): Draft {
  const scoped = graphDraft(draft, graphId);
  return scoped
    ? replaceGraphDraft(draft, graphId, {
        ...scoped,
        layout: { ...scoped.layout, [id]: position },
      })
    : draft;
}

/** Edge index of graphId removed. */
export function disconnectStep(
  draft: Draft,
  graphId: string,
  index: number,
): Draft {
  const scoped = graphDraft(draft, graphId);
  const removed = scoped?.definition.edges[index];
  return scoped
    ? replaceGraphDraft(draft, graphId, {
        ...scoped,
        definition: {
          ...scoped.definition,
          edges: scoped.definition.edges.filter((edge) => edge !== removed),
        },
      })
    : draft;
}

/** The draft with these frames; none at all leaves the draft without the key. */
export function withFrames(
  draft: Draft,
  frames: NonNullable<Draft["frames"]>,
): Draft {
  if (frames.length) return { ...draft, frames };
  // Every other field stays, whatever the draft grows later.
  const unframed = { ...draft };
  delete unframed.frames;
  return unframed;
}
