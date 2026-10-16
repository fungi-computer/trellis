import type { GraphStartRequest } from "@fungi.computer/braid/runtime";
import { workflowIdSchema } from "@fungi.computer/braid";
import * as z from "zod";
import * as S from "effect/Schema";
import { defineAppMethod } from "@fungi.computer/agar/backend-definition";
import { gitSha1Schema } from "@fungi.computer/puffball/git-representation";
import {
  publishedRun,
  runReply,
  documentRead,
  versionsRead,
  rebuildCopiesInput,
  rebuildCopiesReply,
  saveReply,
  publishReply,
  publicationStatus,
  publicationIdSchema,
  workflow,
  libraryListing,
  libraryPageInput,
  history,
  revisionSchema,
  shareExportReply,
  shareCopyReply,
} from "@fungi.computer/workflows-wire";
import { readWorkflowCatalog } from "./catalog.js";
import { createWorkflowLibrary } from "./library.js";
import { createWorkflowShare } from "./share.js";
import type { WorkflowMethodContext } from "./methods.js";

async function catalog(
  context: WorkflowMethodContext,
  appIds: readonly string[],
) {
  const available = await readWorkflowCatalog(context.env.WORKFLOWS, appIds);
  if (available === null) throw new Error("Workflow catalog unavailable");
  return available;
}

function library(context: WorkflowMethodContext) {
  const options: Parameters<typeof createWorkflowLibrary>[0] = {
    author: { name: "Trellis", email: "trellis@app.local" },
    catalog: (appIds) => catalog(context, appIds),
  };
  if (context.env.GIT) options.git = context.env.GIT;
  if (context.env.BACKGROUND) options.background = context.env.BACKGROUND;
  if (context.indexes) options.index = context.indexes;
  return createWorkflowLibrary(options);
}
/** The single published-copy owner used by portable sharing and local forks. */
export function sharing(context: WorkflowMethodContext) {
  return createWorkflowShare({
    library: library(context),
    catalog: (appIds) => catalog(context, appIds),
  });
}

export const libraryMethods = {
  exportWorkflow: defineAppMethod({
    description:
      "Export an immutable published Workflow version as a portable file.",
    effect: "read",
    requires: ["git.repository"],
    input: z.strictObject({
      workflowId: workflowIdSchema,
      version: z.number().int().positive(),
    }),
    output: shareExportReply,
    handler: (input, context: WorkflowMethodContext) =>
      sharing(context).exportWorkflow(input),
  }),
  importWorkflow: defineAppMethod({
    description:
      "Check a portable Workflow file and save a new unpublished draft row.",
    effect: "write",
    requires: ["git.repository", "workflow.run"],
    input: z.strictObject({
      bytes: z.string(),
      sha256: z.string(),
      workflowId: workflowIdSchema,
    }),
    output: shareCopyReply,
    handler: (input, context: WorkflowMethodContext) =>
      sharing(context).importWorkflow(input),
  }),
  forkWorkflow: defineAppMethod({
    description:
      "Copy an immutable published Workflow version into a new unpublished draft row of this library.",
    effect: "write",
    requires: ["git.repository", "workflow.run"],
    input: z.strictObject({
      sourceWorkflowId: workflowIdSchema,
      version: z.number().int().positive(),
      workflowId: workflowIdSchema,
    }),
    output: shareCopyReply,
    handler: (input, context: WorkflowMethodContext) =>
      sharing(context).forkPublishedWorkflow({
        sourceWorkflowId: input.sourceWorkflowId,
        at: { version: input.version },
        workflowId: input.workflowId,
      }),
  }),
  listWorkflows: defineAppMethod({
    description: "List this installation's saved Workflow library.",
    effect: "read",
    requires: ["git.repository"],
    input: libraryPageInput,
    output: libraryListing,
    handler: async (input, context: WorkflowMethodContext) => {
      const saved = await library(context).list();
      if (!Array.isArray(saved)) return saved;
      const available = saved
        .filter(
          (item) => input.after === undefined || item.workflowId > input.after,
        )
        .sort((a, b) => a.workflowId.localeCompare(b.workflowId));
      const items = available.slice(0, input.limit);
      const last = items.at(-1);
      return available.length > input.limit && last
        ? { items, next: last.workflowId }
        : { items };
    },
  }),
  rebuildCopies: defineAppMethod({
    hidden: true,
    description: "Rebuild saved screen copies in one bounded foreground page.",
    effect: "read",
    requires: ["git.repository"],
    input: rebuildCopiesInput,
    output: rebuildCopiesReply,
    handler: async (input, context: WorkflowMethodContext) =>
      rebuildCopiesReply.parse(
        await library(context).rebuildCopies(input.cursor, input.target),
      ),
  }),
  loadWorkflow: defineAppMethod({
    description:
      "Read a saved draft row or immutable published copy, including editor layout.",
    effect: "read",
    requires: ["git.repository"],
    input: workflow.extend({
      at: z.union([
        z.literal("draft"),
        z.strictObject({ commit: gitSha1Schema }),
      ]),
    }),
    output: documentRead,
    handler: async (input, context: WorkflowMethodContext) =>
      documentRead.parse(
        await library(context).read(input.workflowId, input.at),
      ),
  }),
  saveDraft: defineAppMethod({
    description:
      "Validate and save a Workflow draft using its expected row revision.",
    effect: "write",
    requires: ["workflow.run"],
    input: workflow.extend({
      draft: z.json(),
      expectedRevision: revisionSchema,
    }),
    output: saveReply,
    handler: async (input, context: WorkflowMethodContext) =>
      saveReply.parse(
        await library(context).saveDraft(
          input.workflowId,
          input.draft,
          input.expectedRevision,
        ),
      ),
  }),
  publishWorkflow: defineAppMethod({
    description:
      "Publish a validated draft to main and create its immutable version tag.",
    effect: "write",
    requires: ["git.repository", "workflow.run", "workflow.publish"],
    input: workflow.extend({ expectedRevision: revisionSchema }),
    output: publishReply,
    handler: async (input, context: WorkflowMethodContext, caller) =>
      publishReply.parse(
        await library(context).publish(
          input.workflowId,
          input.expectedRevision,
          caller,
        ),
      ),
  }),
  continuePublication: defineAppMethod({
    hidden: true,
    description: "Continue one freshly admitted member's publication step.",
    effect: "write",
    requires: [
      "git.repository",
      "workflow.run",
      "workflow.publish",
      "workflow.arm",
      "media.generation",
      "computer.writeFile",
    ],
    input: z.strictObject({}),
    output: z.strictObject({ more: z.boolean() }),
    handler: (_input, context: WorkflowMethodContext, caller) =>
      library(context).continuePublication(caller),
  }),
  publicationStatus: defineAppMethod({
    description: "Read publication progress without accessing Git.",
    effect: "read",
    requires: ["workflow.publish"],
    input: workflow.extend({
      publicationId: publicationIdSchema,
    }),
    output: publicationStatus,
    handler: (input, context: WorkflowMethodContext, caller) =>
      library(context).publicationStatus(
        input.workflowId,
        input.publicationId,
        caller,
      ),
  }),
  listVersions: defineAppMethod({
    description: "List a Workflow's published version tags, newest first.",
    effect: "read",
    requires: ["git.repository"],
    input: workflow,
    output: versionsRead,
    handler: async (input, context: WorkflowMethodContext) =>
      versionsRead.parse(await library(context).versions(input.workflowId)),
  }),
  workflowHistory: defineAppMethod({
    description: "Read up to fifty published Workflow versions.",
    effect: "read",
    requires: ["git.repository"],
    input: workflow,
    output: history,
    handler: async (input, context: WorkflowMethodContext) =>
      library(context).history(input.workflowId),
  }),
  revertDraft: defineAppMethod({
    description: "Restore a published Workflow version as a new draft row.",
    effect: "write",
    requires: ["git.repository", "workflow.run"],
    input: workflow.extend({
      toCommit: gitSha1Schema,
      expectedRevision: revisionSchema,
    }),
    output: saveReply,
    handler: async (input, context: WorkflowMethodContext) =>
      saveReply.parse(
        await library(context).revert(
          input.workflowId,
          input.toCommit,
          input.expectedRevision,
        ),
      ),
  }),
  runWorkflow: defineAppMethod({
    description:
      "Run an immutable published Workflow version or commit; drafts never execute. An optional delivery chat receives the run's ending.",
    effect: "write",
    requires: ["workflow.run"],
    input: publishedRun,
    output: runReply,
    handler: async (input, context: WorkflowMethodContext) => {
      const document = library(context).publishedRow(input.workflowId, input);
      if (!document) return { error: "not_found" };
      if (!context.env.WORKFLOWS)
        throw new Error("Workflow access is not granted");
      const base: GraphStartRequest = {
        requestId: input.requestId,
        definition: S.decodeUnknownSync(S.Json)(document.definition),
        published: {
          workflowId: input.workflowId,
          commit: document.commit,
          digest: document.digest,
        },
        bindings: input.bindings,
        input: input.input,
      };
      const request: GraphStartRequest =
        input.delivery === undefined
          ? base
          : { ...base, delivery: input.delivery };
      return runReply.parse(await context.env.WORKFLOWS.runGraph(request));
    },
  }),
};
