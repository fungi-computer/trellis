import { Button } from "@fungi.computer/caps/components/button";
import { iterationProgress } from "./graph-results.js";
import type { RunStep } from "../runs/run-state.js";

/** "12 of 12": how many of a loop's rounds have finished, once any have run. */
export function loopProgressWords(results: readonly RunStep[]) {
  const progress = iterationProgress(results);
  return progress
    ? `${String(progress.done)} of ${String(progress.total)}`
    : undefined;
}

/**
 * The inside of a loop's card: its one-line summary, how far a run got, and
 * the way in. The body is never drawn on the card; it opens as its own graph.
 */
export function LoopBody({
  summary,
  results,
  onEnter,
}: {
  summary: string;
  results: readonly RunStep[];
  onEnter?: () => void;
}) {
  const progress = loopProgressWords(results);
  return (
    <div className="wf-loop">
      <p className="wf-node-loop" title={summary}>
        {summary}
      </p>
      {progress ? <p className="wf-node-progress">{progress}</p> : null}
      {onEnter ? (
        <Button
          size="xs"
          variant="ghost"
          className="nodrag"
          onClick={(event) => {
            // Opening is not choosing the card: that would send a phone to the panel.
            event.stopPropagation();
            onEnter();
          }}
        >
          Open
        </Button>
      ) : null}
    </div>
  );
}
