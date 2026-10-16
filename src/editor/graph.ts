import {
  parseProjection,
  ports,
  methodInputPorts,
  methodOutputPorts,
  validate,
  type Catalog,
  type Node,
  type PortRef,
  type PortSchema,
  type WorkflowDefinition,
} from "@fungi.computer/braid";
import type { Draft } from "./draft-store.js";
import { codeNodePorts } from "./code-node.js";

export function methodFor(
  definition: WorkflowDefinition,
  catalog: Catalog,
  node: Node,
) {
  if (node.kind !== "app") return undefined;
  const app = Object.hasOwn(definition.apps, node.app)
    ? definition.apps[node.app]
    : undefined;
  const entry =
    app && Object.hasOwn(catalog, app.appId) ? catalog[app.appId] : undefined;
  return entry && Object.hasOwn(entry.methods, node.method)
    ? entry.methods[node.method]
    : undefined;
}

/** Display ports only; W0 remains the authority for accepting every edit. */
export function nodePorts(
  definition: WorkflowDefinition,
  catalog: Catalog,
  id: string,
  seen: ReadonlySet<string> = new Set(),
) {
  const node = definition.nodes.find((item) => item.id === id);
  const inputs: Record<string, PortSchema> = {};
  const outputs: Record<string, PortSchema> = {};
  if (id === "$input")
    return { inputs, outputs: ports(parseProjection(definition.input)) };
  if (!node) return { inputs, outputs };
  inputs.after = {};
  outputs.after = {};
  const method = methodFor(definition, catalog, node);
  if (method) {
    Object.assign(
      inputs,
      ports(methodInputPorts(parseProjection(method.input))),
    );
    Object.assign(outputs, methodOutputPorts(parseProjection(method.output)));
  }
  switch (node.kind) {
    case "code": {
      const declared = codeNodePorts(node);
      Object.assign(inputs, declared.inputs);
      Object.assign(outputs, declared.outputs);
      break;
    }
    case "review": {
      const ref = node.show.at(0);
      const schema: PortSchema =
        ref && !seen.has(id)
          ? (nodePorts(definition, catalog, ref.node, new Set([...seen, id]))
              .outputs[ref.port] ?? {})
          : {};
      inputs.show = schema;
      if (node.choices?.length)
        for (const choice of node.choices) outputs[choice.id] = schema;
      else {
        outputs.approved = schema;
        outputs.rejected = schema;
      }
      outputs.choice = { type: "string" };
      outputs.note = { type: "string", maxLength: 1000 };
      break;
    }
    case "condition":
      inputs.test = {};
      outputs.true = {};
      outputs.false = {};
      break;
    case "repeat":
      inputs.item = {};
      outputs.result = { type: "object" };
      outputs.exhausted = { type: "object" };
      break;
    case "map":
      inputs.items = { type: "array", items: {} };
      outputs.items = { type: "array", items: { type: "object" } };
      break;
    case "transform":
      for (const key of Object.keys(node.fields)) outputs[key] = {};
      break;
    case "app":
    case "wait":
      break;
  }
  return { inputs, outputs };
}

export function connect(
  draft: Draft,
  catalog: Catalog,
  from: PortRef,
  to: PortRef,
):
  | { readonly ok: true; readonly draft: Draft }
  | { readonly ok: false; readonly message: string } {
  const target = draft.definition.nodes.find((node) => node.id === to.node);
  if (!target) return { ok: false, message: "Choose a destination node" };
  const review = target.kind === "review" && to.port === "show";
  const map = target.kind === "map" && to.port === "items";
  const definition: WorkflowDefinition = {
    ...draft.definition,
    nodes:
      review || map
        ? draft.definition.nodes.map((node) =>
            node === target
              ? target.kind === "map"
                ? { ...target, over: from }
                : { ...target, show: [from] }
              : node,
          )
        : draft.definition.nodes,
    edges:
      review || map
        ? draft.definition.edges
        : [
            ...draft.definition.edges.filter(
              (edge) => edge.to.node !== to.node || edge.to.port !== to.port,
            ),
            { from, to },
          ],
  };
  const issues = validate(definition, catalog);
  const refusal = issues.find(
    (issue) =>
      issue.code === "cycle" ||
      issue.code === "schema" ||
      (issue.edge === definition.edges.length - 1 && !(review || map)) ||
      ((review || map) &&
        issue.node === to.node &&
        ["unknown_port", "unassignable_edge", "subgraph"].includes(issue.code)),
  );
  return refusal
    ? { ok: false, message: refusal.message }
    : { ok: true, draft: { ...draft, definition } };
}

export function addNode(
  draft: Draft,
  node: Node,
  position: { x: number; y: number },
): Draft {
  return {
    ...draft,
    definition: {
      ...draft.definition,
      nodes: [...draft.definition.nodes, node],
    },
    layout: { ...draft.layout, [node.id]: position },
  };
}

export function removeNode(draft: Draft, id: string): Draft {
  return {
    ...draft,
    definition: {
      ...draft.definition,
      nodes: draft.definition.nodes.filter((node) => node.id !== id),
      edges: draft.definition.edges.filter(
        (edge) => edge.from.node !== id && edge.to.node !== id,
      ),
    },
    layout: Object.fromEntries(
      Object.entries(draft.layout).filter(([key]) => key !== id),
    ),
  };
}
