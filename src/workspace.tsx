import type { HostUi } from "@fungi.computer/agar";
import { PortableShare } from "./sharing/portable-share.js";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@fungi.computer/caps/components/button";
import { Select } from "@fungi.computer/caps/components/select";
import { WorkflowEditor } from "./editor/editor.js";
import { emptyDraft } from "./editor/draft-store.js";
import { rowDraftStore } from "./editor/row-draft-store.js";
import { Runs } from "./runs/runs.js";
import { RunWorkflow } from "./runs/run-workflow.js";
import type { ReadMedia } from "./runs/review-card.js";
import { Triggers } from "./triggers/triggers.js";
import { Templates } from "./templates/templates.js";
import type { WorkflowClient } from "./workflow-client.js";
import type { AppOpenRequest } from "@fungi.computer/agar";
import { workflowIdSchema } from "@fungi.computer/braid";
export function WorkflowWorkspace({
  client,
  view,
  onView,
  readMedia,
  browserActions,
  openRequest,
}: {
  client: WorkflowClient;
  view: string;
  onView: (view: string) => void;
  readMedia?: ReadMedia;
  browserActions?: Pick<HostUi, "requestBrowserAction">;
  openRequest?: AppOpenRequest | null;
}) {
  const [library, setLibrary] = useState<Awaited<
    ReturnType<WorkflowClient["listWorkflows"]>
  > | null>(null);
  const [workflowId, setWorkflowId] = useState<string | null>(null);
  const [selectedRun, setSelectedRun] = useState<string | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [slow, setSlow] = useState(false);
  const handledRequest = useRef<{
    client: WorkflowClient;
    requestId: string;
  } | null>(null);
  useEffect(() => {
    if (openRequest?.kind !== "navigate") return;
    if (
      handledRequest.current?.client === client &&
      handledRequest.current.requestId === openRequest.requestId
    )
      return;
    const target = workflowIdSchema.safeParse(
      openRequest.params.find((param) => param.key === "workflow")?.value,
    );
    if (!target.success) return;
    handledRequest.current = { client, requestId: openRequest.requestId };
    setWorkflowId(target.data);
    setSelectedRun(null);
    onView("editor");
  }, [client, openRequest, onView]);
  useEffect(() => {
    let active = true;
    setError(null);
    setSlow(false);
    const timer = window.setTimeout(() => {
      if (active) setSlow(true);
    }, 5000);
    const show = (
      items: Awaited<ReturnType<WorkflowClient["listWorkflows"]>>,
    ) => {
      window.clearTimeout(timer);
      if (!active) return;
      setSlow(false);
      setLibrary(items);
      setWorkflowId(
        (current) =>
          current ??
          (Array.isArray(items) ? items.at(0)?.workflowId : null) ??
          null,
      );
    };
    void client
      .listWorkflows()
      .then(async (items) => {
        show(items);
        if (Array.isArray(items) || !active) return;
        const refreshed = await client.rebuildCopies();
        show(refreshed);
      })
      .catch((cause: unknown) => {
        window.clearTimeout(timer);
        if (active)
          setError(
            new Error("The workflow library could not be updated.", { cause }),
          );
      });
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [client, attempt]);
  const store = useMemo(
    () => (workflowId ? rowDraftStore(client, workflowId) : null),
    [client, workflowId],
  );
  const choose = (id: string) => {
    setWorkflowId(id);
    setAttempt((value) => value + 1);
    onView("editor");
  };
  async function create() {
    setBusy(true);
    setError(null);
    try {
      choose(await client.createDraft("workflow", emptyDraft()));
    } catch (cause) {
      setError(
        new Error("The workflow library could not be updated.", { cause }),
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      {view !== "templates" ? (
        <div className="wf-topbar">
          <Select
            aria-label="Workflow"
            className="select-sm"
            value={workflowId ?? ""}
            onChange={(event) => {
              setWorkflowId(event.currentTarget.value || null);
            }}
          >
            <option value="" disabled>
              Choose a workflow…
            </option>
            {(Array.isArray(library) ? library : []).map((item) => (
              <option key={item.workflowId} value={item.workflowId}>
                {item.title}
              </option>
            ))}
          </Select>
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => void create()}
          >
            New
          </Button>
          {browserActions ? (
            <PortableShare
              key={workflowId ?? "import"}
              client={client}
              browserActions={browserActions}
              workflowId={workflowId}
              onImported={choose}
            />
          ) : null}
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="wf-page">
          {error.message}{" "}
          {library && !Array.isArray(library) ? null : (
            <Button
              variant="ghost"
              onClick={() => {
                setAttempt((value) => value + 1);
              }}
            >
              Retry
            </Button>
          )}
        </p>
      ) : null}
      <div className="wf-editor-host" hidden={view !== "editor"}>
        {store && workflowId ? (
          <WorkflowEditor
            key={workflowId}
            store={store}
            runPanel={(version) => (
              <RunWorkflow
                key={version}
                client={client}
                workflowId={workflowId}
                version={version}
                onRun={(id) => {
                  setSelectedRun(id);
                  onView("runs");
                }}
              />
            )}
          />
        ) : (
          <main className="wf-page">
            <h1>
              {library && !Array.isArray(library)
                ? error
                  ? "Workflow list unavailable"
                  : "Finding your workflows…"
                : library
                  ? "Create your first workflow"
                  : error
                    ? "Workflow list unavailable"
                    : "Loading workflows…"}
            </h1>
            {library && !Array.isArray(library) ? (
              <p role="status">
                {error
                  ? "Your saved workflows are still in Git. The list could not be refreshed."
                  : "Your saved workflows will appear here shortly."}
              </p>
            ) : library ? (
              <p>Start with a new workflow or choose a template.</p>
            ) : !error ? (
              <p role="status">
                {slow
                  ? "Loading is taking longer than usual. You can keep waiting or retry."
                  : "Your workflow list will appear here."}
                {slow ? (
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setAttempt((value) => value + 1);
                    }}
                  >
                    Retry
                  </Button>
                ) : null}
              </p>
            ) : null}
          </main>
        )}
      </div>
      {view === "runs" ? (
        <Runs
          client={client}
          workflowId={workflowId ?? undefined}
          selectedRun={selectedRun}
          onSelect={setSelectedRun}
          readMedia={readMedia}
        />
      ) : null}
      {view === "triggers" ? (
        <Triggers client={client} workflowId={workflowId} />
      ) : null}
      {view === "templates" ? (
        <Templates client={client} onUse={choose} />
      ) : null}
    </>
  );
}
