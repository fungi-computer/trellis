import type { StatusTone } from "@fungi.computer/caps/components/status";
import type { AgentScheduleRow } from "@fungi.computer/shiitake-extensions/schedules";
import type { SigilName } from "@fungi.computer/sigils";
import { cadenceWords } from "../triggers/schedule.js";
import type { WorkflowSchedule } from "./page.js";

export type ScheduleAction = "pause" | "resume" | "delete";
export type ScheduleSubject =
  | { kind: "workflow"; row: WorkflowSchedule }
  | {
      kind: "agent";
      row: AgentScheduleRow;
      agentName: string;
      canManage: boolean;
    };

type Fact = {
  sigil: SigilName;
  label: string;
  value: string;
  dateTime?: string;
  alert?: boolean;
};

/** The owner row is already decoded; this module owns words, never scheduling. */
export function presentSchedule(
  subject: ScheduleSubject,
  now: number,
  viewerZone: string,
) {
  const record =
    subject.kind === "workflow" ? subject.row : subject.row.schedule;
  const loop =
    subject.kind === "agent" && subject.row.kind === "loop"
      ? subject.row.schedule
      : null;
  const kindLabel =
    subject.kind === "workflow"
      ? "Workflow schedule"
      : loop
        ? "Session Loop"
        : "Reminder";
  const kindSigil: SigilName =
    subject.kind === "workflow" ? "trellis" : loop ? "loop" : "schedule";
  const title =
    subject.kind === "workflow"
      ? subject.row.workflowId
      : subject.row.schedule.prompt;
  const repeats = record.cron
    ? cadenceWords(record.cron.expression)
    : loop
      ? "When the Agent decides"
      : "Once";
  const zone =
    record.cron && record.cron.timeZone !== viewerZone
      ? record.cron.timeZone.replaceAll("_", " ")
      : null;
  let nextRun: string;
  let dateTime: string | undefined;
  switch (record.state) {
    case "paused":
      nextRun = "After you resume";
      break;
    case "finished":
      nextRun = "Done";
      break;
    case "cancelled":
    case "failed":
      nextRun = "Stopped";
      break;
    case "active":
      if (record.nextDueAt === null) {
        nextRun = "When the Agent decides";
      } else if (record.nextDueAt <= now) {
        const attempts =
          subject.kind === "agent"
            ? subject.row.kind === "almanac"
              ? subject.row.schedule.attempt
              : subject.row.schedule.consecutiveFailures
            : 0;
        nextRun = record.lastError || attempts > 0 ? "Retrying" : "Due now";
      } else {
        nextRun = new Intl.DateTimeFormat(undefined, {
          weekday: "short",
          day: "numeric",
          month: "short",
          hour: "2-digit",
          minute: "2-digit",
          hourCycle: "h23",
          timeZone: record.cron?.timeZone ?? viewerZone,
        }).format(record.nextDueAt);
        dateTime = new Date(record.nextDueAt).toISOString();
      }
  }
  const status: { label: string; tone: StatusTone } =
    record.state === "failed"
      ? { label: "Failed", tone: "error" }
      : record.lastError
        ? { label: "Needs attention", tone: "error" }
        : {
            active: { label: "Active", tone: "success" as const },
            paused: { label: "Paused", tone: "neutral" as const },
            finished: { label: "Finished", tone: "neutral" as const },
            cancelled: { label: "Stopped", tone: "neutral" as const },
          }[record.state];
  const canManage = subject.kind === "workflow" || subject.canManage;
  const keys: ScheduleAction[] = !canManage
    ? []
    : record.state === "active"
      ? ["pause", "delete"]
      : record.state === "paused"
        ? ["resume", "delete"]
        : [];
  const facts: Fact[] =
    subject.kind === "workflow"
      ? [{ sigil: "trellis", label: "Workflow", value: title }]
      : [
          { sigil: "sendPrompts", label: "Prompt", value: title },
          { sigil: "agent", label: "Agent", value: subject.agentName },
        ];
  facts.push(
    { sigil: "working", label: "Repeats", value: repeats },
    { sigil: "schedule", label: "Next run", value: nextRun, dateTime },
  );
  if (zone) facts.push({ sigil: "internet", label: "Time zone", value: zone });
  // The Loop projection has no starting member identity. Neither the viewer nor
  // the Agent directory identifies that person; omit unknown human attribution.
  if (loop?.origin === "model")
    facts.push({
      sigil: "agent",
      label: "Started by",
      value: "The Agent",
    });
  if (record.lastError)
    facts.push({
      sigil: "error",
      label: "Problem",
      value: record.lastError,
      alert: true,
    });
  const summary =
    subject.kind === "workflow" ? repeats : `${kindLabel} · ${repeats}`;
  return {
    title,
    kindLabel,
    kindSigil,
    status,
    nextRun,
    facts,
    keys,
    viewOnly: !canManage,
    line:
      record.state === "active" && dateTime
        ? `${summary} · Next ${nextRun}${zone ? ` · ${zone}` : ""}`
        : summary,
  };
}
