import {
  parseProjection,
  mappingRefs,
  predicateRefs,
  type Catalog,
  type Graph,
  type Issue,
  type Node,
  type PortRef,
  type WorkflowDefinition,
} from "@fungi.computer/braid";
import { methodFor } from "./graph.js";
import type { DraftDocument } from "./draft-store.js";

export type DisplayEdge = {
  id: string;
  from: PortRef;
  to: PortRef;
};

/** Declared dependencies remain data in the definition, never synthetic edits. */
export function displayEdges(
  graph: Graph,
  issues: readonly Issue[] = [],
): DisplayEdge[] {
  const edges = graph.edges.map((edge, index) => ({
    ...edge,
    id: String(index),
  }));
  for (const node of graph.nodes) {
    // Validation already reports malformed mapping grammar to the inspector.
    if (
      issues.some(
        (issue) => issue.node === node.id && issue.code === "template",
      )
    )
      continue;
    const mapped = (
      values: Readonly<Record<string, Parameters<typeof mappingRefs>[0]>>,
      targetPort?: string,
    ) =>
      Object.entries(values).flatMap(([port, value]) =>
        mappingRefs(value).map((from) => ({
          from,
          to: { node: node.id, port: targetPort ?? port },
        })),
      );
    const references =
      node.kind === "map"
        ? [{ from: node.over, to: { node: node.id, port: "items" } }]
        : node.kind === "repeat"
          ? [
              {
                from: { node: "$input", port: "item" },
                to: { node: node.id, port: "item" },
              },
            ]
          : node.kind === "review"
            ? node.show.map((from) => ({
                from,
                to: { node: node.id, port: "show" },
              }))
            : node.kind === "condition"
              ? predicateRefs(node.test).map((from) => ({
                  from,
                  to: { node: node.id, port: "test" },
                }))
              : node.kind === "app" || node.kind === "code"
                ? mapped(node.values)
                : node.kind === "transform"
                  ? mapped(node.fields, "after")
                  : [];
    for (const [index, edge] of references.entries())
      if (
        !edges.some(
          (existing) =>
            existing.from.node === edge.from.node &&
            existing.from.port === edge.from.port &&
            existing.to.node === edge.to.node &&
            existing.to.port === edge.to.port,
        )
      )
        edges.push({ ...edge, id: `reference-${node.id}-${String(index)}` });
  }
  return edges;
}

/** Exclusive branch descendants appear in their branch, while shared joins stay outside. */
export function conditionBranches(
  graph: Graph,
  node: Extract<Node, { kind: "condition" }>,
) {
  const edges = displayEdges(graph);
  const reachable = (port: "true" | "false") => {
    const ids = new Set<string>();
    const pending = edges
      .filter((edge) => edge.from.node === node.id && edge.from.port === port)
      .map((edge) => edge.to.node);
    while (pending.length) {
      const id = pending.pop();
      if (!id || id === node.id || ids.has(id)) continue;
      ids.add(id);
      pending.push(
        ...edges
          .filter((edge) => edge.from.node === id)
          .map((edge) => edge.to.node),
      );
    }
    return ids;
  };
  const yes = reachable("true"),
    no = reachable("false");
  return {
    true: graph.nodes.filter((step) => yes.has(step.id) && !no.has(step.id)),
    false: graph.nodes.filter((step) => no.has(step.id) && !yes.has(step.id)),
  };
}

export function bodySteps(graph: Graph) {
  const grouped = new Set(
    graph.nodes.flatMap((node) =>
      node.kind === "condition"
        ? Object.values(conditionBranches(graph, node))
            .flat()
            .map((step) => step.id)
        : [],
    ),
  );
  return graph.nodes.filter(
    (step) => step.kind !== "transform" && !grouped.has(step.id),
  );
}

function humanTitle(id: string) {
  const words = id
    .replace(/([a-z0-9])([A-Z])/gu, "$1 $2")
    .replace(/[_-]+/gu, " ");
  return words.charAt(0).toUpperCase() + words.slice(1).toLowerCase();
}

const purposes = {
  input: "Supply values for this run.",
  map: "Run the body once for each item.",
  repeat: "Run the body again until its stop condition is met.",
  review: "Pause for a person to choose what happens next.",
  condition: "Choose a branch based on the supplied values.",
  transform: "Prepare values for the next steps.",
  wait: "Pause before continuing.",
  code: "Transform the supplied values with this script.",
} as const;

export function nodePresentation(
  definition: WorkflowDefinition,
  catalog: Catalog,
  node: Node,
  appDisplay: DraftDocument["appDisplay"],
  loading = false,
) {
  const method = methodFor(definition, catalog, node);
  if (node.kind === "app") {
    const raw = method?.description.replace(/\s+/gu, " ").trim();
    const description = raw === "" ? undefined : raw;
    const purpose = description?.split(/(?<=[.!?])\s/u)[0];
    const words = node.method
      .replace(/([a-z0-9])([A-Z])/gu, "$1 $2")
      .replace(/[_-]+/gu, " ");
    const app = Object.hasOwn(definition.apps, node.app)
      ? appDisplay[definition.apps[node.app].appId]?.displayName
      : undefined;
    // Before the first catalog answer a step is loading, not unavailable.
    const title =
      method || loading
        ? words.charAt(0).toUpperCase() + words.slice(1).toLowerCase()
        : "App method unavailable";
    return {
      title,
      purpose: `${app ?? "App"} · ${loading ? "Loading Apps…" : (purpose ?? "Install the declared App to describe this step.")}`,
    };
  }
  if (node.kind === "code") {
    const input = parseProjection(node.input);
    return {
      title: input.title ?? humanTitle(node.id),
      purpose: input.description ?? purposes.code,
    };
  }
  return {
    title:
      node.kind === "repeat"
        ? `Repeat up to ${String(node.maxRounds)} times`
        : node.kind === "review"
          ? node.title
          : node.kind === "map"
            ? "For each item"
            : node.kind === "condition"
              ? "Choose a branch"
              : node.kind === "transform"
                ? humanTitle(node.id)
                : "Wait",
    purpose: purposes[node.kind],
  };
}

export function bodyDefinition(definition: WorkflowDefinition, node: Node) {
  if (node.kind !== "map" && node.kind !== "repeat") return undefined;
  const graph = definition.subgraphs?.[node.body];
  return graph ? { ...definition, ...graph } : undefined;
}

export const inputPurpose = purposes.input;
