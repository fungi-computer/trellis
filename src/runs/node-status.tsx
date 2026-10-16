import {
  Status,
  type StatusTone,
} from "@fungi.computer/caps/components/status";
import type { NodeState } from "./run-state.js";
const tones = {
  queued: "neutral",
  running: "info",
  waiting: "warning",
  complete: "success",
  failed: "error",
  skipped: "neutral",
  cancelled: "neutral",
} satisfies Record<NodeState, StatusTone>;
export function NodeStatus({ state }: { state: NodeState }) {
  return (
    <Status
      role="img"
      aria-label={state}
      label={state}
      data-state={state}
      glyph="dot"
      size="compact"
      tone={tones[state]}
    />
  );
}
