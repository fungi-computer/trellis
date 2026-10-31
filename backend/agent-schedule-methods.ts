import { defineAppMethod } from "@fungi.computer/agar/backend-definition";
import {
  listAgentSchedulesInputSchema,
  agentScheduleTargetSchema,
  agentSchedulesReplySchema,
  agentScheduleControlReplySchema,
  decodeAgentSchedulePage,
  decodeAgentScheduleControl,
} from "../shared/agent-schedules.js";
import type { WorkflowMethodContext } from "./methods.js";

const granted = (context: WorkflowMethodContext) => {
  if (!context.env.AGENTS)
    throw new Error("Agent schedules are unavailable from this host");
  return context.env.AGENTS;
};

export const agentScheduleMethods = {
  listAgentSchedules: defineAppMethod({
    description:
      "Read one bounded native schedule page for an authorized Agent.",
    effect: "read",
    requires: ["agent.read"],
    input: listAgentSchedulesInputSchema,
    output: agentSchedulesReplySchema,
    handler: async (input, context: WorkflowMethodContext) =>
      decodeAgentSchedulePage(await granted(context).schedules(input)),
  }),
  pauseAgentSchedule: defineAppMethod({
    description:
      "Pause future occurrences of the exact listed Agent schedule, retaining accepted work.",
    effect: "write",
    requires: ["agent.manage"],
    input: agentScheduleTargetSchema,
    output: agentScheduleControlReplySchema,
    handler: async (input, context: WorkflowMethodContext) =>
      decodeAgentScheduleControl(await granted(context).pauseSchedule(input)),
  }),
  resumeAgentSchedule: defineAppMethod({
    description:
      "Resume future occurrences of the exact listed Agent schedule, retaining accepted work.",
    effect: "write",
    requires: ["agent.manage"],
    input: agentScheduleTargetSchema,
    output: agentScheduleControlReplySchema,
    handler: async (input, context: WorkflowMethodContext) =>
      decodeAgentScheduleControl(await granted(context).resumeSchedule(input)),
  }),
  deleteAgentSchedule: defineAppMethod({
    description:
      "Cancel future occurrences of the exact listed Agent schedule, retaining accepted work and history.",
    effect: "write",
    requires: ["agent.manage"],
    input: agentScheduleTargetSchema,
    output: agentScheduleControlReplySchema,
    handler: async (input, context: WorkflowMethodContext) =>
      decodeAgentScheduleControl(await granted(context).deleteSchedule(input)),
  }),
};
