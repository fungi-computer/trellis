import type {
  AgentSchedulePage,
  AgentScheduleRow,
  AgentScheduleTarget,
} from "@fungi.computer/shiitake-extensions/schedules";
import type { WorkflowClient } from "../workflow-client.js";

export type WorkflowSchedule = Exclude<
  Awaited<ReturnType<WorkflowClient["listTriggers"]>>,
  { error: string }
>["schedules"][number];

/** Keep the listed Session and Loop identities together; never select a replacement. */
export function scheduleTarget(row: AgentScheduleRow): AgentScheduleTarget {
  return row.kind === "almanac"
    ? { kind: row.kind, agentId: row.agentId, scheduleId: row.schedule.id }
    : {
        kind: row.kind,
        agentId: row.agentId,
        sessionId: row.schedule.sessionId,
        loopId: row.schedule.loopId,
      };
}

export function scheduleKey(target: AgentScheduleTarget): string {
  return JSON.stringify(
    target.kind === "almanac"
      ? [target.kind, target.agentId, target.scheduleId]
      : [target.kind, target.agentId, target.sessionId, target.loopId],
  );
}

/** These values have already crossed their owner's maintained decoder. */
export function agentPageRows(agentId: string, page: AgentSchedulePage) {
  if (page.next !== null)
    throw new Error("Schedule state is incomplete; controls are unavailable.");
  const seen = new Set<string>();
  for (const row of page.items) {
    if (row.agentId !== agentId)
      throw new Error(
        "Schedule state belongs to another Agent; controls are unavailable.",
      );
    const key = scheduleKey(scheduleTarget(row));
    if (seen.has(key))
      throw new Error("Duplicate schedule identity; controls are unavailable.");
    seen.add(key);
  }
  return page.items;
}

export function workflowPageRows(
  page: Awaited<ReturnType<WorkflowClient["listTriggers"]>>,
) {
  if ("error" in page) throw new Error(page.error);
  if (page.nextCursor !== null)
    throw new Error("Schedule state is incomplete; controls are unavailable.");
  const seen = new Set<string>();
  for (const row of page.schedules) {
    if (seen.has(row.scheduleId))
      throw new Error("Duplicate schedule identity; controls are unavailable.");
    seen.add(row.scheduleId);
  }
  return page.schedules;
}
