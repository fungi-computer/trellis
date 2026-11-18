import {
  dependencies,
  type Graph,
  type WorkflowDefinition,
} from "@fungi.computer/braid";

/** What a test of a draft will run: the narrowed definition and its step ids. */
export type TestScope = Readonly<{
  definition: WorkflowDefinition;
  /** Every root step the test runs, in the definition's own order. */
  steps: readonly string[];
  /** How many of those steps come before the tested one; zero for the whole draft. */
  before: number;
}>;

/**
 * The steps a test runs. With no `step` it is the whole draft. With one, it is
 * that step plus every step it depends on, through wires and value
 * references; later steps never run. Null when the step is not in the draft.
 * One pure function shared by the method and the "Testing X and the N steps
 * before it" line.
 */
export function testScope(
  definition: WorkflowDefinition,
  step?: string,
): TestScope | null {
  if (step === undefined)
    return {
      definition,
      steps: definition.nodes.map((node) => node.id),
      before: 0,
    };
  const graph: Graph = definition;
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const wanted = new Set<string>();
  const pending = [step];
  for (let id = pending.pop(); id !== undefined; id = pending.pop()) {
    const node = byId.get(id);
    if (node === undefined || wanted.has(id)) continue;
    wanted.add(id);
    for (const ref of dependencies(graph, node)) pending.push(ref.node);
  }
  if (!wanted.has(step)) return null;
  const nodes = graph.nodes.filter((node) => wanted.has(node.id));
  return {
    definition: {
      ...definition,
      nodes,
      edges: graph.edges.filter(
        (edge) => wanted.has(edge.from.node) && wanted.has(edge.to.node),
      ),
      output: {},
    },
    steps: nodes.map((node) => node.id),
    before: nodes.length - 1,
  };
}
