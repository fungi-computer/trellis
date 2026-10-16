import type { Draft } from "./draft-store.js";

/** Node identities are scoped by graph; body ids may repeat root ids. */
export type NodeAddress = { graphId: string; nodeId: string };

export function graphDraft(draft: Draft, graphId: string): Draft | undefined {
  if (graphId === "root") return draft;
  const graph = draft.definition.subgraphs?.[graphId];
  return graph
    ? { definition: { ...draft.definition, ...graph }, layout: {} }
    : undefined;
}

export function replaceGraphDraft(
  draft: Draft,
  graphId: string,
  next: Draft,
): Draft {
  if (graphId === "root") return next;
  const { input, nodes, edges, output } = next.definition;
  return {
    ...draft,
    definition: {
      ...draft.definition,
      apps: next.definition.apps,
      subgraphs: {
        ...next.definition.subgraphs,
        [graphId]: { input, nodes, edges, output },
      },
    },
  };
}
