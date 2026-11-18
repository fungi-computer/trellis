import { useState } from "react";
import type { Node } from "@fungi.computer/braid";
import { WorkflowEditor } from "../src/editor/editor.js";
import { memoryDraftStore, type Draft } from "../src/editor/draft-store.js";
import { ChromeFrame } from "./chrome-frame.js";
import {
  redesignAppDisplay,
  redesignCatalog,
  weeklyCover,
} from "./redesign-fixtures.js";
import "@xyflow/react/dist/style.css";
import "../src/trellis.css";
import "../src/editor/editor.css";

export default { title: "Trellis redesign" };

/** The real editor over a draft held in this window; the browser proof drives it with a mouse and keys. */
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

const cover = weeklyCover;

/** 04-A: Tab on empty canvas opens the search at the pointer, with a ghost of the step. */
export function AddStepSearch() {
  return <Hand draft={cover} />;
}

/** 05: a wire dragged off the cover's image pin and let go over empty canvas lists the steps that take an image. */
export function DragFromPin() {
  return <Hand draft={cover} />;
}

/** 06: the same image wire dropped on a text pin; a post with a text input waits below the cover. */
export function WireMismatch() {
  const post: Node = {
    id: "post",
    kind: "app",
    app: "grove",
    method: "sendMessage",
    methodDigest: "fixture-grove-send-message",
    title: "Tell #field-notes",
    values: {},
  };
  return (
    <Hand
      draft={{
        definition: {
          ...cover.definition,
          apps: { ...cover.definition.apps, grove: { appId: "Grove" } },
          nodes: [...cover.definition.nodes, post],
        },
        layout: { ...cover.layout, post: { x: 1020, y: 260 } },
      }}
    />
  );
}
