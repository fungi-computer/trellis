import type { Draft } from "./draft-store.js";

/** Node identities are scoped by graph; body ids may repeat root ids. */
export type NodeAddress = { graphId: string; nodeId: string };

/**
 * A body graph's node positions live in the draft's one layout map under
 * `<graphId>/<nodeId>`. Braid node ids match `^[A-Za-z][A-Za-z0-9_-]*$`, so the
 * `/` can never collide with a root node's id.
 */
const bodyPrefix = (graphId: string) => `${graphId}/`;

export function graphDraft(draft: Draft, graphId: string): Draft | undefined {
  if (graphId === "root") return draft;
  const graph = draft.definition.subgraphs?.[graphId];
  if (!graph) return undefined;
  const prefix = bodyPrefix(graphId);
  return {
    definition: { ...draft.definition, ...graph },
    layout: Object.fromEntries(
      Object.entries(draft.layout)
        .filter(([key]) => key.startsWith(prefix))
        .map(([key, position]) => [key.slice(prefix.length), position]),
    ),
  };
}

export function replaceGraphDraft(
  draft: Draft,
  graphId: string,
  next: Draft,
): Draft {
  if (graphId === "root") return next;
  const { input, nodes, edges, output } = next.definition;
  const prefix = bodyPrefix(graphId);
  return {
    ...draft,
    layout: {
      ...Object.fromEntries(
        Object.entries(draft.layout).filter(([key]) => !key.startsWith(prefix)),
      ),
      ...Object.fromEntries(
        Object.entries(next.layout).map(([key, position]) => [
          `${prefix}${key}`,
          position,
        ]),
      ),
    },
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
