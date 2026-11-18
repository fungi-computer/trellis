import { useState } from "react";
import { ReactFlowProvider } from "@xyflow/react";
import { validate } from "@fungi.computer/braid";
import { WorkflowCanvas } from "../src/editor/canvas.js";
import { cardSize } from "../src/editor/canvas-layout.js";
import type { Draft } from "../src/editor/draft-store.js";
import {
  disconnectStep,
  enteredView,
  issuesOfGraph,
  moveStep,
  useEnteredGraph,
  withFrames,
} from "../src/editor/entered-graph.js";
import type { NodeAddress } from "../src/editor/graph-address.js";
import type { RunStep } from "../src/runs/run-state.js";
import {
  redesignAppDisplay,
  redesignCatalog,
  storyboard,
} from "./redesign-fixtures.js";
import "@xyflow/react/dist/style.css";
import "../src/trellis.css";
import "../src/editor/editor.css";

export default { title: "Trellis redesign" };

/** A frame of the body round the steps from `first` to `last`, with room for its label. */
function around(
  id: string,
  label: string,
  tone: "teal" | "mauve",
  first: keyof typeof storyboard.draft.layout,
  last: keyof typeof storyboard.draft.layout,
): NonNullable<Draft["frames"]>[number] {
  const from = storyboard.draft.layout[first];
  const to = storyboard.draft.layout[last];
  const margin = 12;
  return {
    id,
    graph: "attempt",
    label,
    tone,
    x: from.x - margin,
    y: -72,
    width: to.x - from.x + cardSize.width + margin * 2,
    height: 280,
  };
}
/** The two comment frames of screen 16, drawn around the body's steps. */
const bodyFrames: NonNullable<Draft["frames"]> = [
  around("make", "Make the panel", "teal", "attempt/prepare", "attempt/panel"),
  around("ask", "Ask Ana", "mauve", "attempt/keep", "attempt/decision"),
];
/** All twelve rounds of the storyboard's loop finished. */
const twelveRounds: readonly RunStep[] = Array.from(
  { length: 12 },
  (_, index) => ({
    nodeId: "forEachBeat",
    iteration: String(index),
    state: "complete",
    attempt: 1,
  }),
);

/** A live canvas: enter a loop, press C, name a frame, drag, colour or delete it. */
function Stage({
  start,
  frames,
  results = [],
}: {
  start: string;
  frames?: Draft["frames"];
  results?: readonly RunStep[];
}) {
  const [draft, setDraft] = useState<Draft>(() => {
    // Each body's input sits to the left of its first step.
    const placed: Draft = {
      ...storyboard.draft,
      layout: {
        ...storyboard.draft.layout,
        "beat/$input": { x: -(cardSize.width + 32), y: 0 },
        "attempt/$input": { x: -(cardSize.width + 32), y: 0 },
      },
    };
    return frames ? withFrames(placed, frames) : placed;
  });
  const [selected, setSelected] = useState<NodeAddress | null>(null);
  const inside = useEnteredGraph(start);
  const view = enteredView(
    draft,
    inside.entered,
    redesignCatalog,
    redesignAppDisplay,
  );
  return (
    <div
      className="wf-editor"
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(0, 1fr)",
        gridTemplateRows: "minmax(0, 1fr)",
        boxSizing: "border-box",
        position: "fixed",
        inset: 0,
        height: "auto",
      }}
    >
      <ReactFlowProvider>
        <WorkflowCanvas
          key={view.graphId}
          graphId={view.graphId}
          draft={view.scoped}
          frames={draft.frames}
          onFramesChange={(next) => {
            setDraft((current) => withFrames(current, next));
          }}
          onEnter={inside.enter}
          onExit={() => {
            inside.enter(view.parent);
          }}
          crumb={view.crumb}
          nodeResults={results}
          catalog={redesignCatalog}
          appDisplay={redesignAppDisplay}
          issues={issuesOfGraph(
            validate(draft.definition, redesignCatalog),
            view.graphId,
          )}
          selected={selected}
          onSelect={setSelected}
          onMove={(id, position) => {
            setDraft((current) =>
              moveStep(current, view.graphId, id, position),
            );
          }}
          onConnect={() => undefined}
          onRemove={() => undefined}
          onDisconnect={(index) => {
            setDraft((current) => disconnectStep(current, view.graphId, index));
          }}
        />
      </ReactFlowProvider>
    </div>
  );
}

/** 16: inside the repeat of "For each beat", two comment frames group its steps; Back leaves. */
export function LoopBodyFrames() {
  return <Stage start="attempt" frames={bodyFrames} />;
}

/** 16: the same map closed on the canvas, one card with "12 of 12" and a way in. */
export function LoopClosed() {
  return <Stage start="root" results={twelveRounds} />;
}
