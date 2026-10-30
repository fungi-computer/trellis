import { workflowLibraryGill } from "./gills.js";
import * as z from "zod";
import type { GraphStartRequest } from "@fungi.computer/braid/runtime";
import { memberInboxItemSchema } from "@fungi.computer/agar/inbox";
import { catalogReplySchema as catalogReply } from "./catalog.js";
import type { BackgroundBinding } from "@fungi.computer/puffball/background-replay";
import type { GitBinding } from "@fungi.computer/agar/git";
import type { WorkflowIndexes } from "./indexes.js";
import { scheduleMethods } from "./schedule-methods.js";
import { toolFamilyMethods } from "./tool-family.js";
import { libraryMethods } from "./library-methods.js";
import * as Schema from "effect/Schema";
import { reviewAnswerSchema } from "@fungi.computer/braid";
import {
  defineAppBackend,
  defineAppMethod,
} from "@fungi.computer/agar/backend-definition";
import {
  chatsReplySchema,
  type WorkflowTriggerArmTarget,
  type ScheduleListInput,
  answerReviewReply,
  cancelReplySchema,
  catalogInputSchema,
  runListItemSchema,
  runsReplySchema,
  statusReply,
  viewerReplySchema,
} from "@fungi.computer/workflows-wire";
import { workflowIdSchema } from "@fungi.computer/braid";

const identity = z.string().min(1).max(256);
const inboxPage = z.object({ items: z.array(z.json()).max(200) });
export type WorkflowMethodContext = Readonly<{
  indexes?: WorkflowIndexes;
  env: Readonly<{
    GIT?: GitBinding;
    /** The member's Inbox, read only to offer chats for run reports. */
    INBOX?: Readonly<{
      page(input: { after: string | null }): Promise<typeof Schema.Json.Type>;
    }>;
    BACKGROUND?: BackgroundBinding;
    WORKFLOWS?: Readonly<{
      armEventTrigger(
        input: WorkflowTriggerArmTarget,
      ): Promise<typeof Schema.Json.Type>;
      disarmEventTrigger(input: {
        eventTriggerId: string;
      }): Promise<typeof Schema.Json.Type>;
      eventTriggers(
        input: Record<string, never>,
      ): Promise<typeof Schema.Json.Type>;
      armSchedule(
        input: WorkflowTriggerArmTarget,
      ): Promise<typeof Schema.Json.Type>;
      disarmSchedule(input: {
        scheduleId: string;
      }): Promise<typeof Schema.Json.Type>;
      pauseSchedule(input: {
        scheduleId: string;
      }): Promise<typeof Schema.Json.Type>;
      schedules(input: ScheduleListInput): Promise<typeof Schema.Json.Type>;
      catalog(input: {
        installationId?: string | undefined;
      }): Promise<typeof Schema.Json.Type>;
      runGraph(input: GraphStartRequest): Promise<typeof Schema.Json.Type>;
      cancel(input: { runId: string }): Promise<typeof Schema.Json.Type>;
      graphStatus(input: { runId: string }): Promise<typeof Schema.Json.Type>;
      answerReview(input: {
        runId: string;
        nodeId: string;
        iteration: string;
        answer: typeof reviewAnswerSchema.Type;
      }): Promise<typeof Schema.Json.Type>;
      runs(input: { workflowId?: string }): Promise<typeof Schema.Json.Type>;
    }>;
  }>;
}>;

const granted = (context: WorkflowMethodContext) => {
  if (!context.env.WORKFLOWS) throw new Error("Workflow access is not granted");
  return context.env.WORKFLOWS;
};
export const appBackend = defineAppBackend<WorkflowMethodContext>({
  sync: { method: "continuePublication" },
  gills: [workflowLibraryGill],
  toolFamily: { name: "flows", list: "listWorkflowTools", call: "runWorkflow" },
  methods: {
    ...libraryMethods,
    ...toolFamilyMethods,
    listRuns: defineAppMethod({
      description:
        "List up to fifty runs from this installation, newest first.",
      effect: "read",
      requires: ["workflow.run"],
      input: z.strictObject({ workflowId: workflowIdSchema.optional() }),
      output: z.array(runListItemSchema).max(50),
      handler: async (input, context) => {
        const indexes = context.indexes;
        if (!indexes) throw new Error("Workflow indexes unavailable");
        const reply = runsReplySchema.parse(
          await granted(context).runs(
            input.workflowId === undefined
              ? {}
              : { workflowId: input.workflowId },
          ),
        );
        if ("error" in reply) throw new Error("Workflow run list unavailable");
        return reply.runs.map((row) => {
          const copied = indexes.publications.read(
            `${row.workflowId}:${row.commit}`,
          );
          const published =
            copied.kind === "ready" &&
            copied.head === row.commit &&
            copied.value.commit === row.commit
              ? copied.value
              : null;
          return {
            ...row,
            title: published?.definition.title ?? null,
            version: published?.version ?? null,
          };
        });
      },
    }),
    viewerId: defineAppMethod({
      description:
        "The calling member's own id, so the Runs UI can tell its own runs from a teammate's.",
      effect: "read",
      requires: [],
      input: z.strictObject({}),
      output: viewerReplySchema,
      handler: (_input, _context, caller) =>
        caller.actor.kind === "member"
          ? { memberId: caller.actor.memberId }
          : { error: "not_granted" },
    }),
    ...scheduleMethods,
    listChats: defineAppMethod({
      description:
        "List your existing chats (Agent Sessions) that a run or trigger may report its result to.",
      effect: "read",
      requires: ["agent.read"],
      input: z.strictObject({}),
      output: chatsReplySchema,
      handler: async (_input, context) => {
        if (!context.env.INBOX) return { error: "not_granted" as const };
        const page = inboxPage.parse(
          await context.env.INBOX.page({ after: null }),
        );
        return {
          chats: page.items.flatMap((raw) => {
            const item = Schema.decodeUnknownSync(memberInboxItemSchema)(raw);
            return "kind" in item || !("title" in item)
              ? []
              : [
                  {
                    agentId: item.agentId,
                    sessionId: item.sessionId,
                    title: item.title,
                  },
                ];
          }),
        };
      },
    }),
    catalog: defineAppMethod({
      description:
        "List your installed Apps' methods: a palette index with no port schemas, or one installation's full ports when `installationId` is given.",
      effect: "read",
      requires: ["workflow.run"],
      input: catalogInputSchema,
      output: catalogReply,
      handler: async (input, context) =>
        catalogReply.parse(await granted(context).catalog(input)),
    }),
    runStatus: defineAppMethod({
      description:
        "Read one of your Workflow runs: per-node events, open reviews and the engine's status.",
      effect: "read",
      requires: ["workflow.run"],
      input: z.strictObject({ runId: identity }),
      output: statusReply,
      handler: async (input, context) =>
        statusReply.parse(await granted(context).graphStatus(input)),
    }),
    cancel: defineAppMethod({
      description:
        "Cancel a run you started or administer as the current Team owner. Completed runs remain terminal.",
      effect: "write",
      requires: ["workflow.run"],
      input: z.strictObject({ runId: identity }),
      output: cancelReplySchema,
      handler: async (input, context) =>
        cancelReplySchema.parse(await granted(context).cancel(input)),
    }),
    answerReview: defineAppMethod({
      description:
        "Answer one of your Workflow runs' reviews: approve or reject, or pick one of the review's named choices. Only a person can answer; Agents cannot.",
      effect: "write",
      requires: ["workflow.run"],
      input: z.strictObject({
        runId: identity,
        nodeId: identity,
        iteration: identity,
        answer: z.fromJSONSchema(
          Schema.toJsonSchemaDocument(reviewAnswerSchema).schema,
        ),
      }),
      output: answerReviewReply,
      handler: async (input, context, caller) => {
        if (caller.actor.kind !== "member") return { error: "not_granted" };
        return answerReviewReply.parse(
          await granted(context).answerReview({
            ...input,
            answer: Schema.decodeUnknownSync(reviewAnswerSchema)(input.answer, {
              onExcessProperty: "error",
            }),
          }),
        );
      },
    }),
  },
});
