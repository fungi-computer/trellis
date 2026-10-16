import {
  triggerTargetSchema,
  scheduleArmReplySchema,
  triggerDisarmReplySchema,
  schedulesReplySchema,
  scheduleDisarmInputSchema,
  eventDisarmInputSchema,
  triggerListInputSchema,
  eventArmReplySchema,
  eventTriggersReplySchema,
  type WorkflowTriggerTarget,
} from "@fungi.computer/workflows-wire";
import { defineAppMethod } from "@fungi.computer/agar/backend-definition";
import { createWorkflowLibrary } from "./library.js";
import { readWorkflowCatalog } from "./catalog.js";
import type { WorkflowMethodContext } from "./methods.js";

const granted = (context: WorkflowMethodContext) => {
  if (!context.env.WORKFLOWS) throw new Error("Workflow access is not granted");
  return context.env.WORKFLOWS;
};

/** Read only this App's immutable publication rows; no Git repair occurs in arming. */
function publication(
  context: WorkflowMethodContext,
  target: WorkflowTriggerTarget,
) {
  if (context.indexes === undefined) return null;
  return createWorkflowLibrary({
    index: context.indexes,
    author: { name: "Trellis", email: "trellis@app.local" },
    catalog: async (appIds) => {
      const catalog = await readWorkflowCatalog(context.env.WORKFLOWS, appIds);
      if (catalog === null) throw new Error("Workflow catalog unavailable");
      return catalog;
    },
  }).publishedRow(target.workflowId, { commit: target.commit });
}

const unavailablePublication = {
  kind: "refused" as const,
  reason: "Workflow publication is unavailable; re-arm after publishing",
};

export const scheduleMethods = {
  arm: defineAppMethod({
    description:
      "Arm a published Workflow schedule as you on the pinned Computer. An optional delivery chat receives every run's ending.",
    effect: "write",
    requires: ["workflow.run", "workflow.arm"],
    input: triggerTargetSchema,
    output: scheduleArmReplySchema,
    handler: async (input, context: WorkflowMethodContext) => {
      const workflows = granted(context);
      const stored = publication(context, input);
      if (stored === null) return unavailablePublication;
      return scheduleArmReplySchema.parse(
        await workflows.armSchedule({ ...input, digest: stored.digest }),
      );
    },
  }),
  disarm: defineAppMethod({
    description: "Cancel an armed Workflow schedule.",
    effect: "write",
    requires: ["workflow.run", "workflow.arm"],
    input: scheduleDisarmInputSchema,
    output: triggerDisarmReplySchema,
    handler: async (input, context: WorkflowMethodContext) =>
      triggerDisarmReplySchema.parse(
        await granted(context).disarmSchedule(input),
      ),
  }),
  listTriggers: defineAppMethod({
    description:
      "List this installation's schedules, next run times and paused reasons.",
    effect: "read",
    requires: ["workflow.run"],
    input: triggerListInputSchema,
    output: schedulesReplySchema,
    handler: async (_input, context: WorkflowMethodContext) =>
      schedulesReplySchema.parse(await granted(context).schedules({})),
  }),
  armEventTrigger: defineAppMethod({
    description:
      "Arm a published Workflow App-event trigger as you on the pinned Computer. An optional delivery chat receives every run's ending.",
    effect: "write",
    requires: ["workflow.run", "workflow.arm"],
    input: triggerTargetSchema,
    output: eventArmReplySchema,
    handler: async (input, context: WorkflowMethodContext) => {
      const workflows = granted(context);
      const stored = publication(context, input);
      if (stored === null) return unavailablePublication;
      return eventArmReplySchema.parse(
        await workflows.armEventTrigger({ ...input, digest: stored.digest }),
      );
    },
  }),
  disarmEventTrigger: defineAppMethod({
    description: "Disarm this installation's App-event trigger.",
    effect: "write",
    requires: ["workflow.run", "workflow.arm"],
    input: eventDisarmInputSchema,
    output: triggerDisarmReplySchema,
    handler: async (input, context: WorkflowMethodContext) =>
      triggerDisarmReplySchema.parse(
        await granted(context).disarmEventTrigger(input),
      ),
  }),
  eventTriggers: defineAppMethod({
    description:
      "List this installation's App-event triggers and paused reasons.",
    effect: "read",
    requires: ["workflow.run"],
    input: triggerListInputSchema,
    output: eventTriggersReplySchema,
    handler: async (_input, context: WorkflowMethodContext) =>
      eventTriggersReplySchema.parse(await granted(context).eventTriggers({})),
  }),
};
