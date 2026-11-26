import { Toaster, toast } from "@fungi.computer/caps/components/toaster";
import { savedDraftFixture } from "./draft-store.fixture.js";
import type { Json } from "@fungi.computer/braid";
import { ValueField } from "../src/editor/value-field.js";
import { useEffect, useMemo, useRef, useState } from "react";
import * as S from "effect/Schema";
import { catalogSchema, workflowDefinitionSchema } from "@fungi.computer/braid";
import type { ToastAction } from "../src/agent/ask-agent.js";
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

/** What the catalog read answers until Retry: nothing wrong, a broken Hub, or a refused grant. */
type CatalogRefusal = "reachable" | "broken" | "denied";
const refusals = {
  broken: () => new Error("Catalog 502 fixture"),
  denied: () =>
    Object.assign(new Error("not granted"), { code: "CAPABILITY_DENIED" }),
} as const;

/** A published workflow has no "Publish a version" hint, so nothing else holds the page's top rows. */
const publishedVersion = {
  version: 1,
  commit: "a".repeat(40),
  committedAt: 1,
  message: "Fixture publication",
};

function ContestDraft({
  catalog,
  published = false,
}: {
  catalog: CatalogRefusal;
  published?: boolean;
}) {
  // Only the person's own press of Retry catalog lets the Hub answer.
  const retried = useRef(false);
  // The host's prompt, stable across renders so it can never replay the toast.
  // The person declines the first time and approves the second; approving is
  // what lets the Hub answer.
  const asked = useRef(0);
  const permissions = useMemo(
    () => ({
      requestAppPermissions: () => {
        asked.current += 1;
        if (asked.current === 1) return Promise.resolve("declined" as const);
        retried.current = true;
        return Promise.resolve("granted" as const);
      },
    }),
    [],
  );
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
        if (method === "listVersions")
          return Promise.resolve(published ? [publishedVersion] : []);
        if (method === "catalog") {
          if (input === "{}") {
            if (catalog !== "reachable" && !retried.current)
              return Promise.reject(refusals[catalog]());
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
      {/* A maximised window: its header is the top of the page, as in the product. */}
      <div style={{ position: "fixed", inset: 0, overflow: "auto" }}>
        <ChromeFrame pinned>
          <WorkflowEditor
            store={store}
            runPanel={() => <p>Run form fixture</p>}
            offer={offer}
            permissions={permissions}
            active
          />
        </ChromeFrame>
      </div>
      <Toaster id="trellis-contest" />
      <p role="note">
        Fixture only · document and catalog replies are simulated; no
        publication or execution.
      </p>
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
/** The host's toast with one action that stays up, as the workspace shows it. */
function offer(message: string, action: ToastAction) {
  const id = toast.error(message, {
    toasterId: "trellis-contest",
    closeButton: true,
    duration: Infinity,
    action: { label: action.label, onClick: action.onSelect },
  });
  return () => {
    toast.dismiss(id);
  };
}
export const UnpublishedDraft = () => <ContestDraft catalog="reachable" />;
export const CatalogFailure = () => <ContestDraft catalog="broken" />;
/** The catalog read is refused for lack of access: the toast says so, not "couldn't reach the Hub". */
export const CatalogDenied = () => <ContestDraft catalog="denied" />;
/** The same refusal on a published workflow: approving moves nothing on the page. */
export const CatalogDeniedPublished = () => (
  <ContestDraft catalog="denied" published />
);
