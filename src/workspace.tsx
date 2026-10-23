import type { HostUi } from "@fungi.computer/agar";
import { PortableShare, type ShareDialog } from "./sharing/portable-share.js";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@fungi.computer/caps/components/button";
import { ActionRow } from "@fungi.computer/caps/components/action-row";
import { DataList, DataRow } from "@fungi.computer/caps/components/data-list";
import { useChrome, type ChromeCrumb } from "./chrome.js";
import { WorkflowEditor } from "./editor/editor.js";
import { emptyDraft } from "./editor/draft-store.js";
import { rowDraftStore } from "./editor/row-draft-store.js";
import { Runs } from "./runs/runs.js";
import { RunWorkflow } from "./runs/run-workflow.js";
import type { ReadMedia } from "./runs/output-preview.js";
import type { OpenInApp } from "./runs/run-timeline.js";
import { Triggers } from "./triggers/triggers.js";
import { Templates } from "./templates/templates.js";
import type { WorkflowClient } from "./workflow-client.js";
import type { AppOpenRequest } from "@fungi.computer/agar";
import { workflowIdSchema } from "@fungi.computer/braid";
const toolLabels = {
  runs: "Runs",
  editor: "Editor",
  triggers: "Triggers",
} as const;
type Tool = keyof typeof toolLabels;
export type WorkflowScope =
  | { kind: "all-runs" | "templates" | "all-workflows" }
  | { kind: "workflow"; workflowId: string };

export function WorkflowWorkspace({
  client,
  initialScope = { kind: "all-runs" },
  readMedia,
  openIn,
  browserActions,
  openRequest,
}: {
  client: WorkflowClient;
  initialScope?: WorkflowScope;
  readMedia?: ReadMedia;
  openIn?: OpenInApp;
  browserActions?: Pick<HostUi, "requestBrowserAction">;
  openRequest?: AppOpenRequest | null;
}) {
  const [library, setLibrary] = useState<Awaited<
    ReturnType<WorkflowClient["listWorkflows"]>
  > | null>(null);
  const [scope, setScope] = useState<WorkflowScope>(initialScope);
  const [tool, setTool] = useState<Tool>("editor");
  // Window-local picker recency only. Back never reads this list.
  const [recent, setRecent] = useState<readonly string[]>(() =>
    initialScope.kind === "workflow" ? [initialScope.workflowId] : [],
  );
  const workflowId = scope.kind === "workflow" ? scope.workflowId : null;
  // Keep the draft's autosave lifetime when navigating to another scope.
  const [editorWorkflowId, setEditorWorkflowId] = useState(workflowId);
  const [selectedRun, setSelectedRun] = useState<string | null>(null);
  const [shareDialog, setShareDialog] = useState<ShareDialog | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [slow, setSlow] = useState(false);
  const handledRequest = useRef<{
    client: WorkflowClient;
    requestId: string;
  } | null>(null);
  const choose = useCallback((id: string) => {
    setScope({ kind: "workflow", workflowId: id });
    setEditorWorkflowId(id);
    setTool("editor");
    setSelectedRun(null);
    setRecent((current) =>
      [id, ...current.filter((item) => item !== id)].slice(0, 12),
    );
    setAttempt((value) => value + 1);
  }, []);
  useEffect(() => {
    if (openRequest?.kind !== "navigate") return;
    if (
      handledRequest.current?.client === client &&
      handledRequest.current.requestId === openRequest.requestId
    )
      return;
    const run = openRequest.params.find((param) => param.key === "run")?.value;
    if (run !== undefined && run !== "") {
      handledRequest.current = { client, requestId: openRequest.requestId };
      setScope({ kind: "all-runs" });
      setSelectedRun(run);
      return;
    }
    const target = workflowIdSchema.safeParse(
      openRequest.params.find((param) => param.key === "workflow")?.value,
    );
    if (!target.success) return;
    handledRequest.current = { client, requestId: openRequest.requestId };
    choose(target.data);
  }, [client, openRequest, choose]);
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
  const refreshLibrary = useCallback(() => {
    setAttempt((value) => value + 1);
  }, []);
  const store = useMemo(
    () =>
      editorWorkflowId
        ? rowDraftStore(client, editorWorkflowId, refreshLibrary)
        : null,
    [client, editorWorkflowId, refreshLibrary],
  );
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
  const workflows = Array.isArray(library) ? library : [];
  const title = workflows.find((item) => item.workflowId === workflowId)?.title;
  const home = () => {
    setScope({ kind: "all-runs" });
    setSelectedRun(null);
  };
  const trellis: ChromeCrumb = { id: "home", label: "Trellis", select: home };
  const scopeCrumb: ChromeCrumb = {
    id: "scope",
    label:
      scope.kind === "workflow"
        ? (title ?? workflowId ?? "Workflow")
        : scope.kind === "templates"
          ? "Templates"
          : scope.kind === "all-workflows"
            ? "All workflows"
            : "All runs",
    siblings: [
      { id: "all-runs", label: "All runs" },
      { id: "templates", label: "Templates" },
      ...recent.flatMap((id) => {
        const item = workflows.find((item) => item.workflowId === id);
        // One-character namespace preserves Agar's 64-character id bound.
        return item ? [{ id: `w${id}`, label: item.title }] : [];
      }),
      { id: "all-workflows", label: "All workflows…" },
      { id: "new", label: "New workflow" },
    ],
    select: (id) => {
      if (id === undefined) return;
      if (id === "new") {
        if (!busy) void create();
        return;
      }
      if (id === "all-runs" || id === "templates" || id === "all-workflows") {
        setScope({ kind: id });
        setSelectedRun(null);
        return;
      }
      const item = workflows.find((item) => `w${item.workflowId}` === id);
      if (item) choose(item.workflowId);
    },
  };
  const crumbs: readonly ChromeCrumb[] = [
    trellis,
    scopeCrumb,
    ...(scope.kind === "workflow"
      ? [
          {
            id: "tool",
            label: toolLabels[tool],
            siblings: Object.entries(toolLabels).map(([id, label]) => ({
              id,
              label,
            })),
            select: (id?: string) => {
              if (id !== "editor" && id !== "runs" && id !== "triggers") return;
              setTool(id);
              setSelectedRun(null);
            },
          },
        ]
      : []),
  ];
  const editing = scope.kind === "workflow" && tool === "editor";
  const share = browserActions
    ? [
        {
          id: "fork",
          label: "Fork",
          disabled: !workflowId,
          run: () => {
            setShareDialog("fork");
          },
        },
        {
          id: "export",
          label: "Export",
          disabled: !workflowId,
          run: () => {
            setShareDialog("export");
          },
        },
        {
          id: "import",
          label: "Import",
          run: () => {
            setShareDialog("import");
          },
        },
      ]
    : [];
  useChrome("workspace", {
    crumbs,
    menu: [
      {
        id: "new",
        label: "New workflow",
        disabled: busy,
        run: () => void create(),
      },
      ...share,
    ],
    back: {
      can: scope.kind !== "all-runs" || selectedRun !== null,
      go: () => {
        if (selectedRun !== null) setSelectedRun(null);
        else if (scope.kind === "workflow" && tool !== "editor")
          setTool("editor");
        else home();
      },
    },
  });
  return (
    <>
      {browserActions ? (
        <PortableShare
          key={workflowId ?? "import"}
          client={client}
          browserActions={browserActions}
          workflowId={workflowId}
          onImported={choose}
          dialog={shareDialog}
          onDialog={setShareDialog}
        />
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
      {scope.kind === "all-workflows" ? (
        <main className="wf-page">
          <h1>All workflows</h1>
          {!library ? (
            <p role="status">
              {slow
                ? "Loading is taking longer than usual. You can keep waiting or retry."
                : "Loading workflows…"}
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
          {library && !Array.isArray(library) ? (
            <p role="status">Finding your workflows…</p>
          ) : null}
          {Array.isArray(library) && workflows.length === 0 ? (
            <p>Create your first workflow</p>
          ) : null}
          <DataList aria-label="Workflows">
            {workflows.map((item) => (
              <DataRow key={item.workflowId}>
                <ActionRow
                  data-workflow-id={item.workflowId}
                  label={item.title}
                  onClick={() => {
                    choose(item.workflowId);
                  }}
                />
              </DataRow>
            ))}
          </DataList>
        </main>
      ) : null}
      <div className="wf-editor-host" hidden={!editing}>
        {store && editorWorkflowId ? (
          <WorkflowEditor
            key={editorWorkflowId}
            store={store}
            active={editing}
            runPanel={(version) => (
              <RunWorkflow
                key={version}
                client={client}
                workflowId={editorWorkflowId}
                version={version}
                onRun={(id) => {
                  setSelectedRun(id);
                  setTool("runs");
                }}
              />
            )}
          />
        ) : null}
      </div>
      {scope.kind === "all-runs" ||
      (scope.kind === "workflow" && tool === "runs") ? (
        <Runs
          client={client}
          workflowId={workflowId ?? undefined}
          selectedRun={selectedRun}
          onSelect={(id, owner) => {
            choose(owner);
            setTool("runs");
            setSelectedRun(id);
          }}
          readMedia={readMedia}
          openIn={openIn}
        />
      ) : null}
      {scope.kind === "workflow" && tool === "triggers" ? (
        <Triggers client={client} workflowId={workflowId} />
      ) : null}
      {scope.kind === "templates" ? (
        <Templates client={client} onUse={choose} />
      ) : null}
    </>
  );
}
