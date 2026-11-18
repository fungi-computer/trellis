import {
  Status,
  type StatusTone,
} from "@fungi.computer/caps/components/status";
import type { NodeState } from "./run-state.js";
/** What a step's state says on its card, in a person's words. */
export const nodeStateWords = {
  queued: "Not yet",
  running: "Running",
  waiting: "Waiting on you",
  complete: "Done",
  failed: "Failed",
  skipped: "Not reached",
  cancelled: "Cancelled",
} satisfies Record<NodeState, string>;
const tones = {
  queued: "neutral",
  running: "info",
  waiting: "primary",
  complete: "success",
  failed: "error",
  skipped: "neutral",
  cancelled: "neutral",
  problem: "error",
} satisfies Record<NodeState | "problem", StatusTone>;
/**
 * One bead per step state, the same Caps bead the tool timeline wears. `label`
 * words the state for a person; `bare` keeps only the bead and its name. A
 * `problem` is not a run state: it marks a step the editor cannot run yet.
 */
export function NodeStatus({
  state,
  label = state,
  bare = false,
}: {
  state: NodeState | "problem";
  label?: string;
  bare?: boolean;
}) {
  return (
    <Status
      role="img"
      aria-label={label}
      title={bare ? label : undefined}
      {...(bare ? {} : { label })}
      data-state={state}
      glyph="dot"
      motion={state === "running" ? "bounce" : "none"}
      size="compact"
      tone={tones[state]}
    />
  );
}
