import * as z from "zod";
import * as S from "effect/Schema";
import { appMethods } from "@fungi.computer/agar/backend";
import type { CapabilityDirectory } from "@fungi.computer/agar";
import {
  agentList,
  type AppAgentListHandle,
} from "@fungi.computer/agar/agents";
import {
  listAgentSchedulesInputSchema,
  agentScheduleTargetSchema,
  agentSchedulesReplySchema,
  agentScheduleControlReplySchema,
  decodeAgentSchedulePage,
  decodeAgentScheduleControl,
} from "../shared/agent-schedules.js";
import type { AgentScheduleTarget } from "@fungi.computer/shiitake-extensions/schedules";
import {
  catalogSchema,
  workflowDefinitionSchema,
  workflowIdSchema,
  type reviewAnswerSchema,
} from "@fungi.computer/braid";
import { catalogReplySchema } from "../backend/catalog.js";
import * as contract from "@fungi.computer/workflows-wire";
import * as triggers from "@fungi.computer/workflows-wire";
import {
  cancelReplySchema,
  runListItemSchema,
  viewerReplySchema,
} from "@fungi.computer/workflows-wire";
import type { createWorkflowShare } from "../backend/share.js";
import type { Draft } from "./editor/draft-store.js";
import { runStatusSchema } from "./runs/run-state.js";

export type WorkflowTransport = z.output<typeof appMethods.schema>;
export function openWorkflows(capabilities: CapabilityDirectory) {
  return workflowClient(capabilities.require(appMethods), {
    list: () => capabilities.require(agentList).list(),
  });
}
/** The App method schemas decode the wire; the graph owner decodes definitions. */
export function workflowClient(
  transport: WorkflowTransport,
  agents?: AppAgentListHandle,
) {
  async function call<T>(
    method: string,
    input: S.Json,
    schema: z.ZodType<T>,
  ): Promise<T> {
    return schema.parse(await transport.call(method, JSON.stringify(input)));
  }
  async function rebuild(
    target?: z.output<typeof contract.rebuildCopiesInput>["target"],
  ) {
    let cursor: string | null = null;
    for (let page = 0; page < 1024; page++) {
      let input: S.Json = { cursor };
      if (target !== undefined) input = { cursor, target };
      const reply: z.output<typeof contract.rebuildCopiesReply> = await call(
        "rebuildCopies",
        input,
        contract.rebuildCopiesReply,
      );
      if (reply.done) return;
      cursor = reply.cursor;
    }
    throw new Error("Workflow copies are still rebuilding; retry.");
  }
  async function listing() {
    const page = await call(
      "listWorkflows",
      { limit: 100 },
      contract.libraryListing,
    );
    return "kind" in page ? page : page.items;
  }
  async function listChats() {
    const reply = await call("listChats", {}, triggers.chatsReplySchema);
    return "chats" in reply ? reply.chats : [];
  }
  return {
    async listScheduleAgents() {
      if (agents === undefined)
        throw new Error("The Agent directory is unavailable or not granted.");
      return agents.list();
    },
    listAgentSchedules: async (agentId: string) =>
      decodeAgentSchedulePage(
        await call(
          "listAgentSchedules",
          listAgentSchedulesInputSchema.parse({ agentId }),
          agentSchedulesReplySchema,
        ),
      ),
    pauseAgentSchedule: async (target: AgentScheduleTarget) =>
      decodeAgentScheduleControl(
        await call(
          "pauseAgentSchedule",
          agentScheduleTargetSchema.parse(target),
          agentScheduleControlReplySchema,
        ),
      ),
    resumeAgentSchedule: async (target: AgentScheduleTarget) =>
      decodeAgentScheduleControl(
        await call(
          "resumeAgentSchedule",
          agentScheduleTargetSchema.parse(target),
          agentScheduleControlReplySchema,
        ),
      ),
    deleteAgentSchedule: async (target: AgentScheduleTarget) =>
      decodeAgentScheduleControl(
        await call(
          "deleteAgentSchedule",
          agentScheduleTargetSchema.parse(target),
          agentScheduleControlReplySchema,
        ),
      ),
    /**
     * The palette index (every installation, no port schemas) plus a
     * `Catalog` with full ports for only the named `appIds` -- one extra
     * round trip per named App, never the whole installed set.
     */
    async catalog(appIds: readonly string[] = []) {
      const index = await call("catalog", {}, catalogReplySchema);
      if (!("apps" in index))
        throw new Error("error" in index ? index.error : "unavailable");
      const needed = new Set(appIds);
      const matches = index.apps.filter((app) => needed.has(app.appId));
      const details = await Promise.all(
        matches.map((match) =>
          call(
            "catalog",
            { installationId: match.installationId },
            catalogReplySchema,
          ),
        ),
      );
      return {
        apps: index.apps,
        catalog: S.decodeUnknownSync(catalogSchema)(
          Object.fromEntries(
            details.flatMap((detail) =>
              "app" in detail
                ? [
                    [
                      detail.app.appId,
                      detail.app.events === undefined
                        ? { methods: detail.app.methods }
                        : {
                            methods: detail.app.methods,
                            events: detail.app.events,
                          },
                    ] as const,
                  ]
                : [],
            ),
          ),
          { onExcessProperty: "error" },
        ),
      };
    },
    arm: (target: triggers.WorkflowTriggerTarget) =>
      call(
        "arm",
        triggers.triggerTargetSchema.parse(target),
        triggers.scheduleArmReplySchema,
      ),
    pause: (scheduleId: string) =>
      call(
        "pause",
        triggers.schedulePauseInputSchema.parse({ scheduleId }),
        triggers.schedulePauseReplySchema,
      ),
    resume: (scheduleId: string) =>
      call(
        "resume",
        triggers.scheduleResumeInputSchema.parse({ scheduleId }),
        triggers.scheduleResumeReplySchema,
      ),
    disarm: (scheduleId: string) =>
      call(
        "disarm",
        triggers.scheduleDisarmInputSchema.parse({ scheduleId }),
        triggers.triggerDisarmReplySchema,
      ),
    listTriggers: (input: triggers.ScheduleListInput = {}) =>
      call(
        "listTriggers",
        triggers.scheduleListInputSchema.parse(input),
        triggers.schedulesReplySchema,
      ),
    armEventTrigger: (target: triggers.WorkflowTriggerTarget) =>
      call(
        "armEventTrigger",
        triggers.triggerTargetSchema.parse(target),
        triggers.eventArmReplySchema,
      ),
    disarmEventTrigger: (eventTriggerId: string) =>
      call(
        "disarmEventTrigger",
        triggers.eventDisarmInputSchema.parse({ eventTriggerId }),
        triggers.triggerDisarmReplySchema,
      ),
    eventTriggers: () =>
      call(
        "eventTriggers",
        triggers.triggerListInputSchema.parse({}),
        triggers.eventTriggersReplySchema,
      ),
    listWorkflows: listing,
    async rebuildCopies() {
      await rebuild();
      const listed = await listing();
      if (!Array.isArray(listed))
        throw new Error("Workflow copies changed during rebuild; retry.");
      return listed;
    },
    async createDraft(name: string, draft: Draft) {
      const listed = await listing();
      const existing = new Set(
        Array.isArray(listed) ? listed.map((item) => item.workflowId) : [],
      );
      // Workflow repository names are human-readable slugs, not opaque request IDs.
      for (let n = 1; n <= 100; n++) {
        const candidate = workflowIdSchema.parse(`${name}-${String(n)}`);
        if (existing.has(candidate)) continue;
        const result = await call(
          "saveDraft",
          { workflowId: candidate, draft, expectedRevision: 0 },
          contract.saveReply,
        );
        if (result.kind === "saved") return candidate;
        if (result.kind === "invalid")
          throw new Error(
            result.issues.map((issue) => issue.message).join("; "),
          );
      }
      throw new Error("No workflow name is available.");
    },
    async loadWorkflow(
      workflowId: string,
      at: "draft" | { commit: string } = "draft",
    ) {
      let doc = await call(
        "loadWorkflow",
        { workflowId, at },
        contract.documentRead,
      );
      if (doc && "kind" in doc) {
        if (at === "draft")
          throw new Error("Workflow draft row unavailable; reload.");
        await rebuild({ workflowId, at });
        doc = await call(
          "loadWorkflow",
          { workflowId, at },
          contract.documentRead,
        );
      }
      if (doc && "kind" in doc)
        throw new Error("Workflow document is still rebuilding; retry.");
      if (!doc) return null;
      const saved =
        at === "draft"
          ? contract.draftDocument.parse(doc)
          : contract.document.parse(doc);
      return {
        ...saved,
        definition: S.decodeUnknownSync(workflowDefinitionSchema)(
          saved.definition,
        ),
      };
    },
    saveDraft: (workflowId: string, draft: Draft, expectedRevision: number) =>
      call(
        "saveDraft",
        { workflowId, draft, expectedRevision },
        contract.saveReply,
      ),
    exportWorkflow: (
      input: Parameters<
        ReturnType<typeof createWorkflowShare>["exportWorkflow"]
      >[0],
    ) => call("exportWorkflow", input, contract.shareExportReply),
    importWorkflow: (
      input: Parameters<
        ReturnType<typeof createWorkflowShare>["importWorkflow"]
      >[0],
    ) => call("importWorkflow", input, contract.shareCopyReply),
    forkWorkflow: (input: {
      sourceWorkflowId: string;
      version: number;
      workflowId: string;
    }) => call("forkWorkflow", input, contract.shareCopyReply),
    publishWorkflow: (workflowId: string, expectedRevision: number) =>
      call(
        "publishWorkflow",
        { workflowId, expectedRevision },
        contract.publishReply,
      ),
    publicationStatus: (workflowId: string, publicationId: string) =>
      call(
        "publicationStatus",
        { workflowId, publicationId },
        contract.publicationStatus,
      ),
    async listVersions(workflowId: string) {
      let versions = await call(
        "listVersions",
        { workflowId },
        contract.versionsRead,
      );
      if (!Array.isArray(versions)) {
        await rebuild();
        versions = await call(
          "listVersions",
          { workflowId },
          contract.versionsRead,
        );
      }
      if (!Array.isArray(versions))
        throw new Error("Workflow versions changed during rebuild; retry.");
      return versions;
    },
    /** Chats the member may pick for run reports; empty when Inbox is not granted. */
    listChats,
    /** Reporting is optional: a failed read names itself instead of failing the page. */
    chatChoices: () =>
      listChats().then(
        (chats) => ({ kind: "ready" as const, chats }),
        (cause: unknown) => ({ kind: "unavailable" as const, cause }),
      ),
    runWorkflow: (
      input: z.input<typeof contract.runBase> & { version: number },
    ) => call("runWorkflow", input, contract.runReply),
    revertDraft: (
      workflowId: string,
      toCommit: string,
      expectedRevision: number,
    ) =>
      call(
        "revertDraft",
        { workflowId, toCommit, expectedRevision },
        contract.saveReply,
      ),
    listRuns: (workflowId?: string) =>
      call(
        "listRuns",
        workflowId ? { workflowId } : {},
        z.array(runListItemSchema).max(50),
      ),
    /** Who the Runs UI is showing to, so it can tell "You" from a teammate. */
    viewerId: () => call("viewerId", {}, viewerReplySchema),
    cancel: (runId: string) => call("cancel", { runId }, cancelReplySchema),
    async runStatus(runId: string) {
      const result = await call(
        "runStatus",
        { runId },
        z.union([runStatusSchema, z.object({ error: z.string() })]),
      );
      if (!("runId" in result)) throw new Error(result.error);
      return result;
    },
    answerReview: async (input: {
      runId: string;
      nodeId: string;
      iteration: string;
      answer: typeof reviewAnswerSchema.Type;
    }) => {
      const result = await call(
        "answerReview",
        input,
        z.union([
          z.object({
            result: z.enum(["accepted", "denied", "not_waiting", "invalid"]),
          }),
          z.object({ error: z.string() }),
        ]),
      );
      if ("error" in result) throw new Error(result.error);
      return result.result;
    },
  };
}
export type WorkflowClient = ReturnType<typeof workflowClient>;
