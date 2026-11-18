import { useState } from "react";
import { WorkflowEditor } from "../src/editor/editor.js";
import { memoryDraftStore, type Draft } from "../src/editor/draft-store.js";
import { ChromeFrame } from "./chrome-frame.js";
import {
  redesignAppDisplay,
  redesignCatalog,
  weeklyCover,
  weeklyCoverNoPath,
} from "./redesign-fixtures.js";
import "@xyflow/react/dist/style.css";
import "../src/trellis.css";
import "../src/editor/editor.css";

export default { title: "Trellis redesign" };

/** The real editor over a draft held in this window; the browser proof selects the step. */
function Hand({ draft }: { draft: Draft }) {
  const [store] = useState(() =>
    memoryDraftStore(draft, redesignCatalog, redesignAppDisplay),
  );
  return (
    <ChromeFrame>
      <WorkflowEditor store={store} active />
    </ChromeFrame>
  );
}

/** 07-A: Make the cover selected. Its panel names it, wires the prompt from Cover prompt, and offers retry and a note. */
export function StepPanel() {
  return <Hand draft={weeklyCover} />;
}

/** 09, the field half (light): Save the cover has no path, so its Path field is outlined and says so, and the panel header counts it. */
export function ProblemField() {
  return <Hand draft={weeklyCoverNoPath} />;
}
