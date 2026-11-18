import { useState } from "react";
import { WorkflowWorkspace } from "../src/workspace.js";
import { ChromeFrame } from "./chrome-frame.js";
import { switchClient, type SwitchWorld } from "./redesign-s6.fixture.js";
import "@fungi.computer/caps/fonts.css";
import "@xyflow/react/dist/style.css";
import "../src/trellis.css";
import "../src/editor/editor.css";

export default { title: "Trellis redesign" };

/** The whole workspace over a fake service; the browser proof opens the Triggers tab and drives it. */
function Workflow({ world }: { world: SwitchWorld }) {
  const [fixture] = useState(() => switchClient(world));
  return (
    <div className="trellis">
      <ChromeFrame>
        <WorkflowWorkspace
          client={fixture.client}
          initialScope={{ kind: "workflow", workflowId: fixture.workflowId }}
        />
      </ChromeFrame>
    </div>
  );
}

/** 10: the draft's trigger changed, so the tab says "Publish as v4, then switch it on" (captured first); the proof then publishes and switches the workflow on, and the header says "On · next: …". */
export function PublishSwitchOn() {
  return <Workflow world={{ draftAhead: true }} />;
}

/** 10, a refusal: one schedule turns on, the other cannot, so the switch says Partly on and names it. */
export function PartlyOn() {
  return <Workflow world={{ refuseMidweek: true }} />;
}
