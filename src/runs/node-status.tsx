import {
  Status,
  type StatusTone,
} from "@fungi.computer/caps/components/status";
import type { NodeState } from "./run-state.js";
const tones = {
  queued: "neutral",
  running: "info",
  waiting: "primary",
  complete: "success",
  failed: "error",
  skipped: "neutral",
  cancelled: "neutral",
} satisfies Record<NodeState, StatusTone>;
/**
 * One bead per step state, the same Caps bead the tool timeline wears. `label`
 * words the state for a person; `bare` keeps only the bead and its name.
 */
export function NodeStatus({
  state,
  label = state,
  bare = false,
}: {
  state: NodeState;
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
