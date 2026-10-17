import type { PortSchema } from "@fungi.computer/braid";
import type { ReadMedia } from "../runs/review-dock.js";
import { NodeStatus } from "../runs/node-status.js";
import { StepOutput } from "../runs/output-preview.js";
import type { RunStep } from "../runs/run-state.js";

export function nodeResultsFor(
  results: readonly RunStep[],
  nodeId: string,
  graphId?: string,
) {
  return results.filter(
    (step) => step.nodeId === nodeId && step.graphId === graphId,
  );
}

/** Each body iteration keeps its own recorded lifecycle and admitted output. */
export function GraphResults({
  results,
  outputs,
  readMedia,
  showIterations = true,
}: {
  results: readonly RunStep[];
  outputs: Readonly<Record<string, PortSchema>>;
  readMedia?: ReadMedia;
  showIterations?: boolean;
}) {
  const formats = Object.fromEntries(
    Object.entries(outputs).map(([port, schema]) => [port, schema.format]),
  );
  return (
    <>
      {results.map((step) => (
        <section
          key={step.iteration}
          className="wf-graph-result"
          aria-label={
            showIterations ? `Iteration ${step.iteration}` : "Recorded output"
          }
        >
          {showIterations ? (
            <header>
              <NodeStatus state={step.state} />
              <span>Iteration {step.iteration}</span>
            </header>
          ) : null}
          <StepOutput step={step} formats={formats} readMedia={readMedia} />
        </section>
      ))}
    </>
  );
}
