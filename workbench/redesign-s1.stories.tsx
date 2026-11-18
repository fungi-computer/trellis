import { useState } from "react";
import { ReactFlowProvider } from "@xyflow/react";
import { validate } from "@fungi.computer/braid";
import { WorkflowCanvas, type CanvasFrame } from "../src/editor/canvas.js";
import type { Draft } from "../src/editor/draft-store.js";
import type { NodeAddress } from "../src/editor/graph-address.js";
import type { NodeState } from "../src/runs/run-state.js";
import {
  checkEachChange,
  redesignAppDisplay,
  redesignCatalog,
  weeklyCover,
} from "./redesign-fixtures.js";
import "@xyflow/react/dist/style.css";
import "../src/trellis.css";
import "../src/editor/editor.css";

export default { title: "Trellis redesign" };

function Stage({
  draft,
  issues = [],
  frames,
  nodeStates,
  initial = null,
}: {
  draft: Draft;
  issues?: ReturnType<typeof validate>;
  frames?: readonly CanvasFrame[];
  nodeStates?: Readonly<Record<string, NodeState>>;
  initial?: NodeAddress | null;
}) {
  const [selected, setSelected] = useState<NodeAddress | null>(initial);
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
          readOnly
          draft={draft}
          catalog={redesignCatalog}
          appDisplay={redesignAppDisplay}
          issues={issues}
          frames={frames}
          nodeStates={nodeStates}
          selected={selected}
          onSelect={setSelected}
          onMove={() => undefined}
          onConnect={() => undefined}
          onRemove={() => undefined}
          onDisconnect={() => undefined}
        />
      </ReactFlowProvider>
    </div>
  );
}

/** 03-A: Check each change read left to right, a frame around the test steps. */
export function CanvasRead() {
  return (
    <Stage
      draft={checkEachChange}
      frames={[
        {
          id: "tests",
          graph: "root",
          label: "Run the tests on the computer",
          tone: "teal",
          x: 492,
          y: -44,
          width: 4 * 256,
          height: 290,
        },
      ]}
      nodeStates={{
        read: "complete",
        mark: "complete",
        tests: "complete",
        summarise: "complete",
        report: "complete",
      }}
    />
  );
}

/** 09, the node half: Save the cover has no path, so its Path pin goes red and its status line says so. */
export function CanvasProblem() {
  const draft = weeklyCover;
  const broken: Draft = {
    ...draft,
    definition: {
      ...draft.definition,
      nodes: draft.definition.nodes.map((node) =>
        node.id === "save" && node.kind === "app"
          ? { ...node, values: {} }
          : node,
      ),
    },
  };
  return (
    <Stage
      draft={broken}
      issues={validate(broken.definition, redesignCatalog)}
      initial={{ graphId: "root", nodeId: "save" }}
    />
  );
}
