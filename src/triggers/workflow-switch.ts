import type { WorkflowDefinition } from "@fungi.computer/braid";
import type { RunDelivery } from "@fungi.computer/workflows-wire";
import { nextRuns, runWords } from "./schedule.js";
import type { TriggerControl, TriggerRow } from "./triggers.js";

export type Triggers = NonNullable<WorkflowDefinition["triggers"]>;
export type Trigger = Triggers[number];

/** What the one On switch shows for a workflow. */
export type SwitchState =
  | Readonly<{ kind: "unavailable" }>
  | Readonly<{ kind: "off" }>
  | Readonly<{ kind: "on" }>
  | Readonly<{ kind: "partly"; notOn: readonly string[] }>;

/** A webhook cannot be armed here, so the switch never touches it. */
const armable = (triggers: readonly Trigger[]) =>
  triggers.filter((trigger) => trigger.on !== "webhook");

export const triggerName = (trigger: Trigger) => trigger.title ?? trigger.id;

const activeIds = (rows: readonly TriggerRow[]) =>
  new Set(
    rows.filter((row) => row.state === "active").map((row) => row.triggerId),
  );

/** One switch for every armable trigger: on when all are armed, partly on when some are. */
export function switchState(
  triggers: readonly Trigger[],
  rows: readonly TriggerRow[],
): SwitchState {
  const all = armable(triggers);
  if (all.length === 0) return { kind: "unavailable" };
  const active = activeIds(rows);
  const notOn = all.filter((trigger) => !active.has(trigger.id));
  if (notOn.length === 0) return { kind: "on" };
  if (notOn.length === all.length) return { kind: "off" };
  return { kind: "partly", notOn: notOn.map(triggerName) };
}

/** The switch's label: Off, On, or Partly on. */
export const switchLabel = (state: SwitchState) =>
  state.kind === "on" ? "On" : state.kind === "partly" ? "Partly on" : "Off";

/** A trigger that did not change, and why. */
export type SwitchFailure = Readonly<{
  triggerId: string;
  title: string;
  reason: string;
}>;

async function applyEach(
  triggers: readonly Trigger[],
  act: (
    trigger: Trigger,
  ) => Promise<{ kind: string; reason?: string } | undefined>,
  fallback: string,
): Promise<readonly SwitchFailure[]> {
  const failures: SwitchFailure[] = [];
  for (const trigger of triggers) {
    try {
      const result = await act(trigger);
      if (result?.kind === "refused")
        failures.push({
          triggerId: trigger.id,
          title: triggerName(trigger),
          reason: result.reason ?? fallback,
        });
    } catch (cause) {
      // The person gets plain words; the cause stays in the log.
      console.error(`Trigger ${trigger.id} could not be changed`, cause);
      failures.push({
        triggerId: trigger.id,
        title: triggerName(trigger),
        reason: fallback,
      });
    }
  }
  return failures;
}

/**
 * Arm every armable trigger that is not already on, one at a time. A refusal
 * or an error on one never stops the others: the caller reads the new state
 * and names what failed.
 */
export function switchOn(
  control: TriggerControl,
  triggers: readonly Trigger[],
  rows: readonly TriggerRow[],
  bindings: Parameters<TriggerControl["arm"]>[1],
  delivery?: RunDelivery,
) {
  const active = activeIds(rows);
  return applyEach(
    armable(triggers).filter((trigger) => !active.has(trigger.id)),
    (trigger) => control.arm(trigger.id, bindings, delivery),
    "It could not be turned on.",
  );
}

/** Disarm every registration that exists, active or paused. */
export function switchOff(
  control: TriggerControl,
  triggers: readonly Trigger[],
  rows: readonly TriggerRow[],
) {
  const present = new Set(rows.map((row) => row.triggerId));
  return applyEach(
    armable(triggers).filter((trigger) => present.has(trigger.id)),
    (trigger) => control.disarm(trigger.id),
    "It could not be turned off.",
  );
}

/** Name what did not change: `"Weekly digest" did not turn on: reason`. */
export function failureWords(
  failures: readonly SwitchFailure[],
  verb: "on" | "off" = "on",
) {
  return failures
    .map(
      (failure) => `"${failure.title}" did not turn ${verb}: ${failure.reason}`,
    )
    .join(" ");
}

/** The next time any armed schedule fires, in its own zone. */
function nextRunWords(
  triggers: readonly Trigger[],
  rows: readonly TriggerRow[],
  now: number,
): string | undefined {
  const active = activeIds(rows);
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
  return soonest ? runWords(soonest.at, soonest.zone) : undefined;
}

/** The status in the window header: "On · next: Mon 9 Nov, 09:00". */
export function switchStatus(
  triggers: readonly Trigger[],
  rows: readonly TriggerRow[],
  now: number,
): string | undefined {
  const state = switchState(triggers, rows);
  if (state.kind === "unavailable") return undefined;
  const next = nextRunWords(triggers, rows, now);
  const label = switchLabel(state);
  return next === undefined || state.kind === "off"
    ? label
    : `${label} · next: ${next}`;
}
