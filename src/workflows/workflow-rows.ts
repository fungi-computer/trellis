import type { WorkflowRunListItem } from "@fungi.computer/workflows-wire";
import { versionRelativeTime } from "../history/relative-time.js";
import { runSection, type RunStatus } from "../runs/run-state.js";
import { cadenceWords, nextRuns, runWords } from "../triggers/schedule.js";
import { eventLabel } from "../triggers/event-label.js";
import {
  switchState,
  type SwitchState,
  type Trigger,
} from "../triggers/workflow-switch.js";
import type { TriggerRow } from "../triggers/triggers.js";

/** The filters above the Workflows table. */
export const workflowFilters = [
  { id: "all", label: "All" },
  { id: "needs-you", label: "Needs you" },
  { id: "failed", label: "Failed" },
  { id: "off", label: "Off" },
] as const;
export type WorkflowFilter = (typeof workflowFilters)[number]["id"];

/** What the On column shows. "By hand" has no switch; "draft" has nothing to switch yet. */
export type RowSwitch =
  Readonly<{ kind: "draft" }> | Readonly<{ kind: "by-hand" }> | SwitchState;

/** The last run's one-line verdict and the tone its dot wears. */
export type LastRun = Readonly<{
  tone: "success" | "warning" | "error" | "neutral";
  /** What happened: "Failed", "Waiting on you". */
  word: string;
  /** How long ago it started: "9h ago". */
  ago: string;
  /** The run to open from this row's action. */
  runId: string;
  action: "Answer" | "See why" | null;
}>;

/** One row of the Workflows table, ready to draw. */
export type HomeRow = Readonly<{
  workflowId: string;
  title: string;
  /** The App ids this workflow uses, for the row's marks. */
  apps: readonly string[];
  published: boolean;
  starts: string;
  switch: RowSwitch;
  last: LastRun | null;
  next: string | null;
}>;

/** What one workflow's published definition says about when it starts. */
export type PublishedFacts = Readonly<{
  triggers: readonly Trigger[];
  apps: readonly string[];
}>;

/** "Every Monday at 09:00" or "When a change opens"; "By hand" with no trigger. */
export function startsWords(triggers: readonly Trigger[]): string {
  const words = triggers.map((trigger) =>
    trigger.on === "schedule"
      ? cadenceWords(trigger.cron.expression)
      : trigger.on === "event"
        ? (trigger.title ?? `When ${eventLabel(trigger.event).toLowerCase()}`)
        : (trigger.title ?? "When a webhook arrives"),
  );
  return words.length === 0 ? "By hand" : words.join(" · ");
}

/** The soonest armed schedule in its own zone, or the next event for an armed event trigger. */
export function nextWords(
  triggers: readonly Trigger[],
  registrations: readonly TriggerRow[],
  now: number,
): string | null {
  const active = new Set(
    registrations
      .filter((row) => row.state === "active")
      .map((row) => row.triggerId),
  );
  const soonest = triggers
    .flatMap((trigger) =>
      trigger.on === "schedule" && active.has(trigger.id)
        ? nextRuns(trigger.cron, 1, now).map((at) => ({
            at,
            zone: trigger.cron.timeZone,
          }))
        : [],
    )
    .sort((a, b) => a.at - b.at)
    .at(0);
  if (soonest) return runWords(soonest.at, soonest.zone);
  const event = triggers.find(
    (trigger) => trigger.on === "event" && active.has(trigger.id),
  );
  return event?.on === "event"
    ? `On the next ${eventLabel(event.event).toLowerCase()}`
    : null;
}

/** The newest run of each workflow, by start time. */
export function latestRuns(
  runs: readonly WorkflowRunListItem[],
): ReadonlyMap<string, WorkflowRunListItem> {
  const latest = new Map<string, WorkflowRunListItem>();
  for (const run of runs) {
    const known = latest.get(run.workflowId);
    if (known === undefined || run.startedAt > known.startedAt)
      latest.set(run.workflowId, run);
  }
  return latest;
}

/** How a finished or running run reads in the Last run column. */
function lastRun(
  run: WorkflowRunListItem | undefined,
  status: RunStatus | undefined,
  now: number,
): LastRun | null {
  if (run === undefined) return null;
  const ago = versionRelativeTime(new Date(run.startedAt).toISOString(), now);
  const section = runSection(status);
  if (status === undefined)
    return {
      tone: "neutral",
      word: "Running",
      ago,
      runId: run.runId,
      action: null,
    };
  if (section === "needs-you")
    return {
      tone: "warning",
      word: "Waiting on you",
      ago,
      runId: run.runId,
      action: "Answer",
    };
  if (section === "running")
    return {
      tone: "neutral",
      word: "Running",
      ago,
      runId: run.runId,
      action: null,
    };
  if (status.outcome === "cancelled")
    return {
      tone: "neutral",
      word: "Cancelled",
      ago,
      runId: run.runId,
      action: null,
    };
  if (["errored", "failed", "terminated"].includes(status.status))
    return {
      tone: "error",
      word: "Failed",
      ago,
      runId: run.runId,
      action: "See why",
    };
  return {
    tone: "success",
    word: "Done",
    ago,
    runId: run.runId,
    action: null,
  };
}

/** Whether a finished run is the last word on a workflow (a running one is not a failure). */
const settledFailure = (row: HomeRow) => row.last?.tone === "error";

/** One table row from the library entry and what is known about it. */
export function homeRow(input: {
  workflowId: string;
  title: string;
  published: boolean;
  facts: PublishedFacts | null;
  registrations: readonly TriggerRow[];
  run: WorkflowRunListItem | undefined;
  status: RunStatus | undefined;
  now: number;
}): HomeRow {
  const triggers = input.facts?.triggers ?? [];
  const state: RowSwitch = !input.published
    ? { kind: "draft" }
    : triggers.length === 0 ||
        switchState(triggers, input.registrations).kind === "unavailable"
      ? { kind: "by-hand" }
      : switchState(triggers, input.registrations);
  return {
    workflowId: input.workflowId,
    title: input.title,
    apps: input.facts?.apps ?? [],
    published: input.published,
    starts: input.published ? startsWords(triggers) : "Not published yet",
    switch: state,
    last: lastRun(input.run, input.status, input.now),
    next:
      state.kind === "on" || state.kind === "partly"
        ? nextWords(triggers, input.registrations, input.now)
        : null,
  };
}

/** Whether a row passes the filter and the search words. */
export function visibleRow(
  row: HomeRow,
  filter: WorkflowFilter,
  search: string,
): boolean {
  const words = search.trim().toLowerCase();
  if (words !== "" && !row.title.toLowerCase().includes(words)) return false;
  switch (filter) {
    case "all":
      return true;
    case "needs-you":
      return row.last?.action === "Answer";
    case "failed":
      return settledFailure(row);
    case "off":
      return row.switch.kind === "off" || row.switch.kind === "draft";
  }
}

/** "6 workflows · 4 on · 1 needs you · 1 failed", leaving out the zeros. */
export function homeSummary(rows: readonly HomeRow[]): string {
  const count = (test: (row: HomeRow) => boolean) => rows.filter(test).length;
  const on = count(
    (row) => row.switch.kind === "on" || row.switch.kind === "partly",
  );
  const needs = count((row) => row.last?.action === "Answer");
  const failed = count(settledFailure);
  return [
    `${String(rows.length)} ${rows.length === 1 ? "workflow" : "workflows"}`,
    on > 0 ? `${String(on)} on` : null,
    needs > 0 ? `${String(needs)} ${needs === 1 ? "needs" : "need"} you` : null,
    failed > 0 ? `${String(failed)} failed` : null,
  ]
    .filter((part) => part !== null)
    .join(" · ");
}
