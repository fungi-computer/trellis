import * as S from "effect/Schema";
import type { GraphStartRequest } from "@fungi.computer/braid/runtime";
import { defineAppMethod } from "@fungi.computer/agar/backend-definition";
import { definitionAppIds, readWorkflowCatalog } from "./catalog.js";
import { writeSteps } from "./share.js";
import {
  shareReview,
  testDraftInput,
  testDraftReply,
} from "@fungi.computer/workflows-wire";
import type { WorkflowMethodContext } from "./methods.js";
import { testScope } from "./test-scope.js";

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
