import { savedDraftFixture } from "./draft-store.fixture.js";
import type { Json } from "@fungi.computer/braid";
import { ValueField } from "../src/editor/value-field.js";
import { useState } from "react";
import { WorkflowEditor } from "../src/editor/editor.js";
import { memoryDraftStore, emptyDraft } from "../src/editor/draft-store.js";
import { rowDraftStore } from "../src/editor/row-draft-store.js";
import { workflowClient } from "../src/workflow-client.js";
import { fixtureCatalog, fixtureDraft } from "./editor.fixture.js";
import "@xyflow/react/dist/style.css";
export default { title: "Trellis" };
export function Editor() {
  const [store] = useState(() =>
    memoryDraftStore(fixtureDraft, fixtureCatalog, {
      Prints: { displayName: "Prints", icon: "prints" },
      Shed: { displayName: "Shed", icon: "computer" },
    }),
  );
  return <WorkflowEditor store={store} />;
}
export function Empty() {
  const [store] = useState(() =>
    memoryDraftStore(emptyDraft(), fixtureCatalog, {
      Prints: { displayName: "Prints", icon: "prints" },
      Shed: { displayName: "Shed", icon: "computer" },
    }),
  );
  return <WorkflowEditor store={store} />;
}

export function TypedValues() {
  const [value, setValue] = useState<
    { readonly literal: Json } | { readonly template: string }
  >({ literal: { count: 3 } });
  return (
    <>
      <ValueField
        label="Options"
        schema={{ type: "object" }}
        value={value}
        onChange={setValue}
      />
      <output aria-label="Accepted value">{JSON.stringify(value)}</output>
    </>
  );
}

/** Persistent-state UI simulation, never the product's live store. */
export function SavedDraft() {
  const [store] = useState(savedDraftFixture);
  return (
    <>
      <p role="note">
        Fixture only · saved draft, published version and App catalog are
        simulated.
      </p>
      <WorkflowEditor store={store} />
    </>
  );
}

function ContestDraft({ catalogFails }: { catalogFails: boolean }) {
  const [store] = useState(() => {
    let attempts = 0;
    const client = workflowClient({
      call: (method) => {
        if (method === "loadWorkflow")
          return Promise.resolve({ ...fixtureDraft, commit: "a".repeat(40) });
        if (method === "listVersions") return Promise.resolve([]);
        if (method === "catalog") {
          attempts += 1;
          if (catalogFails && attempts === 1)
            return Promise.reject(new Error("Catalog 502 fixture"));
          return Promise.resolve({
            apps: Object.entries(fixtureCatalog).map(([appId, app]) => ({
              appId,
              installationId: appId,
              displayName: appId,
              methods: app.methods,
            })),
          });
        }
        throw new Error(`Fixture does not execute ${method}`);
      },
    });
    return rowDraftStore(client, "panels");
  });
  return (
    <>
      <p role="note">
        Fixture only · document and catalog replies are simulated; no
        publication or execution.
      </p>
      <WorkflowEditor store={store} runPanel={() => <p>Run form fixture</p>} />
    </>
  );
}
export const UnpublishedDraft = () => <ContestDraft catalogFails={false} />;
export const CatalogFailure = () => <ContestDraft catalogFails />;
