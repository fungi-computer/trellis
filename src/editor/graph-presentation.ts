import {
  parseProjection,
  mappingRefs,
  predicateRefs,
  type Catalog,
  type Graph,
  type Issue,
  type Node,
  type PortRef,
  type PortSchema,
  type WorkflowDefinition,
} from "@fungi.computer/braid";
import { humanTitle } from "./human-title.js";
import { methodFor } from "./graph.js";
import { isFlowPin, pinWords, valuePinToken } from "./pins.js";
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

/** Port identities stay in the graph; the canvas explains their role to a reader. */
export function portPresentation(key: string, schema: PortSchema) {
  const labels = new Map([
    ["show", "For review"],
    ["choice", "Your choice"],
    ["note", "Your note"],
    ["after", "After step"],
  ]);
  const label = labels.get(key) ?? humanTitle(key);
  const token = isFlowPin(undefined, "inputs", key, schema)
    ? "flow"
    : valuePinToken(schema);
  return {
    label,
    help:
      schema.description ??
      `${label} carries ${pinWords[token].toLowerCase()}. Connect it to another step to pass the value along.`,
  };
}

const kindWords = {
  input: "Input",
  map: "For each",
  repeat: "Repeat",
  review: "Review",
  condition: "Condition",
  transform: "Transform",
  wait: "Wait",
  code: "Code",
} as const;

/**
 * What a card says about a step: a title for the header and, on its muted right
 * side, where the step comes from (`Prints · Generate image`, or its kind). A
 * step's own `title` always wins; the words below only name a step that has
 * none, such as one saved before steps could be named.
 */
export function nodePresentation(
  definition: WorkflowDefinition,
  catalog: Catalog,
  node: Node,
  appDisplay: DraftDocument["appDisplay"],
  loading = false,
) {
  const method = methodFor(definition, catalog, node);
  if (node.kind === "app") {
    const app = Object.hasOwn(definition.apps, node.app)
      ? appDisplay[definition.apps[node.app].appId]?.displayName
      : undefined;
    // Before the first catalog answer a step is loading, not unavailable.
    if (!method && !loading)
      return {
        title: node.title ?? "App method unavailable",
        meta: `${app ?? "App"} · Install the declared App to describe this step.`,
      };
    const name = humanTitle(node.method);
    return {
      title: node.title ?? name,
      meta: `${app ?? "App"} · ${method ? name : "Loading Apps…"}`,
    };
  }
  if (node.kind === "code") {
    const input = parseProjection(node.input);
    return {
      title: node.title ?? input.title ?? humanTitle(node.id),
      meta: kindWords.code,
    };
  }
  return {
    title:
      node.kind === "review"
        ? node.title
        : (node.title ??
          (node.kind === "repeat"
            ? `Repeat up to ${String(node.maxRounds)} times`
            : node.kind === "map"
              ? "For each item"
              : node.kind === "condition"
                ? "Choose a branch"
                : node.kind === "transform"
                  ? humanTitle(node.id)
                  : "Wait")),
    meta: kindWords[node.kind],
  };
}

export const inputTitle = "Workflow input";
export const inputMeta = kindWords.input;

/** One line for a loop that stays closed on the canvas. */
export function loopSummary(
  definition: WorkflowDefinition,
  node: Extract<Node, { kind: "map" | "repeat" }>,
) {
  const count = definition.subgraphs?.[node.body]?.nodes.length ?? 0;
  const steps = `${String(count)} step${count === 1 ? "" : "s"}`;
  return node.kind === "map"
    ? `${steps} · one at a time`
    : `${steps} · up to ${String(node.maxRounds)} times`;
}

/**
 * What is wrong with a step, in words for its status line, and which of its
 * pins to mark. A missing value reads `Needs a path`; anything else keeps the
 * validator's own sentence.
 */
export function nodeProblem(issues: readonly Issue[], nodeId: string) {
  const first = issues.at(0);
  if (!first) return undefined;
  const ports = new Set(
    issues.flatMap((issue) =>
      issue.node === nodeId && issue.port ? [issue.port] : [],
    ),
  );
  const words =
    issues.length > 1
      ? `${String(issues.length)} problems`
      : first.code === "required_port" && first.port
        ? `Needs a ${portPresentation(first.port, {}).label.toLowerCase()}`
        : first.message;
  return { words, ports };
}
