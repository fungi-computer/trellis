import { Toaster, toast } from "@fungi.computer/caps/components/toaster";
import { savedDraftFixture } from "./draft-store.fixture.js";
import type { Json } from "@fungi.computer/braid";
import { ValueField } from "../src/editor/value-field.js";
import { useEffect, useRef, useState } from "react";
import * as S from "effect/Schema";
import { catalogSchema, workflowDefinitionSchema } from "@fungi.computer/braid";
import { WorkflowEditor } from "../src/editor/editor.js";
import { ChromeFrame } from "./chrome-frame.js";
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
  return (
    <ChromeFrame>
      <WorkflowEditor store={store} active />
    </ChromeFrame>
  );
}
export function Empty() {
  const [store] = useState(() =>
    memoryDraftStore(emptyDraft(), fixtureCatalog, {
      Prints: { displayName: "Prints", icon: "prints" },
      Shed: { displayName: "Shed", icon: "computer" },
    }),
  );
  return (
    <ChromeFrame>
      <WorkflowEditor store={store} active />
    </ChromeFrame>
  );
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
      <ChromeFrame>
        <WorkflowEditor store={store} active />
      </ChromeFrame>
    </>
  );
}

/** The replies a Hub would send, encoded by the real schemas. */
const encodedCatalog = S.encodeSync(catalogSchema)(fixtureCatalog);
const encodedDefinition = S.encodeSync(workflowDefinitionSchema)(
  fixtureDraft.definition,
);

function ContestDraft({ catalogFails }: { catalogFails: boolean }) {
  // Only the person's own press of Retry catalog lets the Hub answer.
  const retried = useRef(false);
  useEffect(() => {
    const press = (event: Event) => {
      if (
        event.target instanceof Element &&
        event.target.closest("button")?.textContent === "Retry catalog"
      )
        retried.current = true;
    };
    document.addEventListener("click", press, true);
    return () => {
      document.removeEventListener("click", press, true);
    };
  }, []);
  const [store] = useState(() => {
    const client = workflowClient({
      call: (method, input) => {
        if (method === "loadWorkflow")
          return Promise.resolve({
            definition: encodedDefinition,
            layout: fixtureDraft.layout,
            revision: 1,
          });
        if (method === "listVersions") return Promise.resolve([]);
        if (method === "catalog") {
          if (input === "{}") {
            if (catalogFails && !retried.current)
              return Promise.reject(new Error("Catalog 502 fixture"));
            return Promise.resolve({
              apps: Object.entries(encodedCatalog).map(([appId, app]) => ({
                appId,
                installationId: appId,
                displayName: appId,
                methods: Object.fromEntries(
                  Object.entries(app.methods).map(([name, method]) => [
                    name,
                    {
                      description: method.description,
                      effect: method.effect,
                      approval: method.approval,
                      requires: method.requires,
                      digest: method.digest,
                    },
                  ]),
                ),
              })),
            });
          }
          for (const [appId, app] of Object.entries(encodedCatalog))
            if (input === JSON.stringify({ installationId: appId }))
              return Promise.resolve({
                app: {
                  appId,
                  installationId: appId,
                  displayName: appId,
                  methods: app.methods,
                },
              });
          return Promise.resolve({ error: "unavailable" });
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
      <ChromeFrame>
        <WorkflowEditor
          store={store}
          runPanel={() => <p>Run form fixture</p>}
          active
        />
      </ChromeFrame>
    </>
  );
}
/** The note bar at the top of the editor; a toast opens below it. */
export function ToastClearance() {
  const [store] = useState(() =>
    memoryDraftStore(emptyDraft(), fixtureCatalog, {
      Prints: { displayName: "Prints", icon: "prints" },
    }),
  );
  return (
    <>
      <ChromeFrame headerless>
        <WorkflowEditor store={store} runPanel={() => <p>Run form</p>} active />
      </ChromeFrame>
      <Toaster id="trellis-proof" />
      <button
        type="button"
        style={{ position: "fixed", insetInlineEnd: 0, insetBlockEnd: 0 }}
        onClick={() => {
          toast("Run started", {
            toasterId: "trellis-proof",
            duration: Infinity,
          });
        }}
      >
        Show notice
      </button>
    </>
  );
}
export const UnpublishedDraft = () => <ContestDraft catalogFails={false} />;
export const CatalogFailure = () => <ContestDraft catalogFails />;
