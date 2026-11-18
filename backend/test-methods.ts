import * as S from "effect/Schema";
import {
  dependencies,
  type Graph,
  type WorkflowDefinition,
} from "@fungi.computer/braid";
import type { GraphStartRequest } from "@fungi.computer/braid/runtime";
import { defineAppMethod } from "@fungi.computer/agar/backend-definition";
import {
  shareReview,
  testDraftInput,
  testDraftReply,
} from "@fungi.computer/workflows-wire";
import { definitionAppIds, readWorkflowCatalog } from "./catalog.js";
import { writeSteps } from "./share.js";
import type { WorkflowMethodContext } from "./methods.js";

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

export const testMethods = {
  testDraft: defineAppMethod({
    description:
      "Run the saved draft of a Workflow as a test, optionally only one step and the steps before it. The run is marked Test, never starts on its own, and stops at every review step like a live run. A step that writes or posts needs allowWrites: true.",
    effect: "write",
    requires: ["workflow.run"],
    input: testDraftInput,
    output: testDraftReply,
    handler: async (input, context: WorkflowMethodContext) => {
      const indexes = context.indexes;
      if (!indexes) throw new Error("Workflow indexes unavailable");
      if (!context.env.WORKFLOWS)
        throw new Error("Workflow access is not granted");
      const draft = indexes.drafts.read(input.workflowId);
      if (draft === null) return { error: "not_found" };
      if (draft.revision !== input.expectedRevision)
        return {
          kind: "draft_conflict" as const,
          currentRevision: draft.revision,
        };
      const scope = testScope(draft.definition, input.step);
      if (scope === null) return { error: "unknown_step" };
      if (input.allowWrites !== true) {
        const available = await readWorkflowCatalog(
          context.env.WORKFLOWS,
          definitionAppIds(scope.definition),
        );
        if (available === null) throw new Error("Workflow catalog unavailable");
        const steps = shareReview.shape.writeNodes.parse(
          writeSteps(scope.definition, available),
        );
        if (steps.length > 0)
          return { kind: "writes_need_confirmation" as const, steps };
      }
      const base: GraphStartRequest = {
        requestId: input.requestId,
        definition: S.decodeUnknownSync(S.Json)(scope.definition),
        test: {
          workflowId: input.workflowId,
          draftRevision: draft.revision,
        },
        bindings: input.bindings,
        input: input.input,
      };
      const request: GraphStartRequest =
        input.delivery === undefined
          ? base
          : { ...base, delivery: input.delivery };
      return testDraftReply.parse(
        await context.env.WORKFLOWS.runGraph(request),
      );
    },
  }),
};
