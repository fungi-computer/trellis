import { useMemo, useRef } from "react";
import * as z from "zod";
import type { HostUi } from "@fungi.computer/agar";
import { Button } from "@fungi.computer/caps/components/button";
import { Sigil } from "@fungi.computer/sigils";
import { WorkflowEditor } from "./editor/editor.js";
import {
  emptyDraft,
  type Draft,
  type DraftCatalog,
  type DraftDocument,
  type DraftStore,
} from "./editor/draft-store.js";
import { rowDraftStore } from "./editor/row-draft-store.js";
import type { WorkflowClient } from "./workflow-client.js";

const capabilityDenied = z.object({ code: z.literal("CAPABILITY_DENIED") });

/** The three ways a workflow can start, as the Start node offers them. */
export type StartKind = "schedule" | "event" | "hand";

/**
 * A draft that lives in this window until the first edit. Nothing is saved,
 * and Git access is not asked for, until the person changes something; then
 * `persist` creates the real draft and the workspace moves onto it.
 */
export function firstRunStore(
  client: WorkflowClient,
  persist: (draft: Draft) => Promise<void>,
): DraftStore {
  const discovery = rowDraftStore(client, "first-run");
  let known: DraftCatalog = { catalog: {}, appDisplay: {}, palette: {} };
  let document: DraftDocument = {
    draft: emptyDraft(),
    revision: 0,
    ...known,
    durability: "memory",
  };
  const untouched = (draft: Draft) =>
    JSON.stringify(draft) === JSON.stringify(emptyDraft());
  return {
    async readCatalog(appIds) {
      known = await discovery.readCatalog(appIds);
      document = { ...document, ...known };
      return known;
    },
    load(version) {
      return Promise.resolve(
        version === undefined ? structuredClone(document) : null,
      );
    },
    async save(next, expectedRevision) {
      if (expectedRevision !== document.revision)
        return { status: "conflict", document: structuredClone(document) };
      if (!untouched(next)) await persist(next);
      document = structuredClone({
        ...document,
        draft: next,
        revision: document.revision + 1,
      });
      return { status: "saved", document: structuredClone(document) };
    },
    listVersions() {
      return Promise.resolve([]);
    },
  };
}

/** The draft a Start choice begins with. */
export function startDraft(kind: StartKind, timeZone: string): Draft {
  const empty = emptyDraft();
  if (kind !== "schedule") return empty;
  return {
    ...empty,
    definition: {
      ...empty.definition,
      triggers: [
        {
          id: "schedule",
          on: "schedule",
          cron: { expression: "0 9 * * *", timeZone },
        },
      ],
    },
  };
}

/**
 * The first workflow: an empty canvas with a dashed Start node that asks what
 * starts it. The canvas is the real editor over a draft that is saved on the
 * first edit, so looking around costs nothing.
 */
export function FirstRun({
  client,
  permissions,
  onCreated,
  onTemplates,
  onFail,
}: {
  client: WorkflowClient;
  permissions?: Pick<HostUi, "requestAppPermissions"> | undefined;
  /** The real draft exists: `kind` says which tool to open it on. */
  onCreated: (workflowId: string, kind: StartKind | null) => void;
  onTemplates: () => void;
  onFail: (message: string) => void;
}) {
  const pending = useRef<StartKind | null>(null);
  async function create(draft: Draft) {
    const make = () => client.createDraft("workflow", draft);
    let id: string;
    try {
      try {
        id = await make();
      } catch (cause) {
        // Git access is asked for here, at the first save, never before.
        if (!capabilityDenied.safeParse(cause).success || !permissions)
          throw cause;
        const outcome = await permissions.requestAppPermissions({
          git: ["git.repository"],
          workflows: ["workflow.publish", "workflow.arm"],
        });
        if (outcome === "declined")
          throw new Error(
            "Trellis needs Git access to save this workflow. Approve it to continue.",
            { cause },
          );
        id = await make();
      }
    } catch (cause) {
      console.error("The first workflow could not be saved", cause);
      throw new Error(
        cause instanceof Error && cause.message.startsWith("Trellis needs")
          ? cause.message
          : "The workflow could not be saved.",
        { cause },
      );
    }
    onCreated(id, pending.current);
  }
  const store = useMemo(() => firstRunStore(client, create), [client]);
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const choices: readonly { kind: StartKind; label: string }[] = [
    { kind: "schedule", label: "On a schedule" },
    { kind: "event", label: "When something happens in an App" },
    { kind: "hand", label: "When I press Run" },
  ];
  return (
    <div className="wf-first-run">
      <WorkflowEditor store={store} active />
      <section
        className="wf-first-start"
        aria-label="What starts this workflow?"
      >
        <h2>
          <Sigil name="trellis" size={16} />
          Start
        </h2>
        <p className="wf-muted">What starts this workflow?</p>
        {choices.map(({ kind, label }) => (
          <Button
            key={kind}
            variant="outline"
            onClick={() => {
              pending.current = kind;
              // The editor reports its own failed save; a Start choice toasts it.
              create(startDraft(kind, zone)).then(
                undefined,
                (cause: unknown) => {
                  onFail(
                    cause instanceof Error
                      ? cause.message
                      : "The workflow could not be saved.",
                  );
                },
              );
            }}
          >
            {label}
          </Button>
        ))}
        <Button variant="ghost" onClick={onTemplates}>
          Start from a template
        </Button>
        <p className="wf-muted">Or press Tab to add a step.</p>
      </section>
    </div>
  );
}
