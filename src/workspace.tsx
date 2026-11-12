import {
  createAppHistory,
  type AppRoot,
  type HostUi,
} from "@fungi.computer/agar";
import { useStore, useWindowStatus } from "@fungi.computer/agar/react";
import * as z from "zod";
import { PortableShare, type ShareDialog } from "./sharing/portable-share.js";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LoadingState } from "@fungi.computer/caps/blocks/loading-state";
import { SetupNotice } from "@fungi.computer/caps/blocks/setup-notice";
import { FailureLine } from "@fungi.computer/caps/components/failure-line";
import { Sigil } from "@fungi.computer/sigils";
import { Button } from "@fungi.computer/caps/components/button";
import {
  Tabs,
  TabsList,
  TabsTrigger,
} from "@fungi.computer/caps/components/tabs";
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
import { Schedules } from "./schedules/schedules.js";
import { Welcome } from "./welcome.js";
import type { WorkflowClient } from "./workflow-client.js";
import type { AppOpenRequest } from "@fungi.computer/agar";
import { workflowIdSchema } from "@fungi.computer/braid";
/**
 * A host refusal for an ungranted capability. It crosses the App's RPC as a
 * plain Error carrying the host AppError's own `code`, never as an AppError.
 */
const capabilityDenied = z.object({ code: z.literal("CAPABILITY_DENIED") });
const toolLabels = {
  runs: "Runs",
  editor: "Editor",
  triggers: "Triggers",
} as const;
type Tool = keyof typeof toolLabels;
export type WorkflowScope =
  | { kind: "all-runs" | "templates" | "all-workflows" | "schedules" }
  | { kind: "workflow"; workflowId: string };
/** One place in Trellis: what Back and Forward move between. */
type Place = Readonly<{
  scope: WorkflowScope;
  tool: Tool;
  selectedRun: string | null;
}>;

export function WorkflowWorkspace({
  client,
  initialScope = { kind: "all-runs" },
  readMedia,
  openIn,
  browserActions,
  permissions,
  openRequest,
  statusApp = null,
}: {
  client: WorkflowClient;
  initialScope?: WorkflowScope;
  readMedia?: ReadMedia;
  openIn?: OpenInApp;
  browserActions?: Pick<HostUi, "requestBrowserAction">;
  /** The host's permission consent; the library needs approved Git access. */
  permissions?: Pick<HostUi, "requestAppPermissions">;
  openRequest?: AppOpenRequest | null;
  /** The App whose window status bar reports the library. */
  statusApp?: Pick<AppRoot, "ui"> | null;
}) {
  const [library, setLibrary] = useState<Awaited<
    ReturnType<WorkflowClient["listWorkflows"]>
  > | null>(null);
  // Back and Forward walk the places the person actually visited, in order.
  const [history] = useState(() =>
    createAppHistory<Place>({
      scope: initialScope,
      tool: "editor",
      selectedRun: null,
    }),
  );
  const {
    current: { scope, tool, selectedRun },
    canGoBack,
    canGoForward,
  } = useStore(history) ?? history.get();
  /** Go somewhere new: a step Back can return from. */
  const go = useCallback(
    (next: Partial<Place>) => {
      history.push({ ...history.get().current, ...next });
    },
    [history],
  );
  const viewingSchedules = scope.kind === "schedules";
  // Window-local picker recency only. Back never reads this list.
  const [recent, setRecent] = useState<readonly string[]>(() =>
    initialScope.kind === "workflow" ? [initialScope.workflowId] : [],
  );
  const workflowId = scope.kind === "workflow" ? scope.workflowId : null;
  // Keep the draft's autosave lifetime when navigating to another scope.
  const [editorWorkflowId, setEditorWorkflowId] = useState(workflowId);
  const [shareDialog, setShareDialog] = useState<ShareDialog | null>(null);
  const [error, setError] = useState<Error | null>(null);
  // Git access is asked for in use, never at install: until the owner
  // approves it the library cannot be read, which is not a failure.
  const [needsGit, setNeedsGit] = useState(false);
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [slow, setSlow] = useState(false);
  const handledRequest = useRef<{
    client: WorkflowClient;
    requestId: string;
  } | null>(null);
  const choose = useCallback(
    (id: string) => {
      history.push({
        scope: { kind: "workflow", workflowId: id },
        tool: "editor",
        selectedRun: null,
      });
      setRecent((current) =>
        [id, ...current.filter((item) => item !== id)].slice(0, 12),
      );
      setAttempt((value) => value + 1);
    },
    [history],
  );
  // The editor follows the workflow being viewed, and outlives a visit elsewhere.
  if (workflowId !== null && workflowId !== editorWorkflowId)
    setEditorWorkflowId(workflowId);
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
      go({ scope: { kind: "all-runs" }, selectedRun: run });
      return;
    }
    const target = workflowIdSchema.safeParse(
      openRequest.params.find((param) => param.key === "workflow")?.value,
    );
    if (!target.success) return;
    handledRequest.current = { client, requestId: openRequest.requestId };
    choose(target.data);
  }, [client, openRequest, choose, go]);
  useEffect(() => {
    if (viewingSchedules) return;
    let active = true;
    setError(null);
    setNeedsGit(false);
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
        if (!active) return;
        if (capabilityDenied.safeParse(cause).success) setNeedsGit(true);
        else
          setError(
            new Error("The workflow library could not be updated.", { cause }),
          );
      });
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [client, attempt, viewingSchedules]);
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
  // One consent covers everything Trellis does with the library: save, publish and arm.
  const [approving, setApproving] = useState(false);
  const approveGit = () => {
    if (!permissions) return;
    setApproving(true);
    permissions
      .requestAppPermissions({
        git: ["git.repository"],
        workflows: ["workflow.publish", "workflow.arm"],
      })
      .then((outcome) => {
        setApproving(false);
        if (outcome !== "declined") refreshLibrary();
      })
      .catch((cause: unknown) => {
        setApproving(false);
        setError(new Error("App permissions could not be opened.", { cause }));
      });
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
  const workflows = Array.isArray(library) ? library : [];
  useWindowStatus(
    statusApp,
    needsGit
      ? [
          {
            id: "library",
            kind: "text",
            text: "Needs Git access",
            tone: "neutral",
          },
        ]
      : Array.isArray(library)
        ? [
            {
              id: "library",
              kind: "text",
              text:
                workflows.length === 0
                  ? "No workflows yet"
                  : `${String(workflows.length)} ${workflows.length === 1 ? "workflow" : "workflows"}`,
            },
          ]
        : [],
  );
  const title = workflows.find((item) => item.workflowId === workflowId)?.title;
  const home = () => {
    go({ scope: { kind: "all-runs" }, tool: "editor", selectedRun: null });
  };
  // A Team with no workflows opens on what Trellis is for, not an empty run list.
  const showWelcome =
    scope.kind === "all-runs" &&
    selectedRun === null &&
    !needsGit &&
    !error &&
    Array.isArray(library) &&
    workflows.length === 0;
  const sections = [
    { id: "all-runs", label: "Runs" },
    { id: "templates", label: "Templates" },
    { id: "all-workflows", label: "Workflows" },
    { id: "schedules", label: "Schedules" },
  ] as const;
  const trellis: ChromeCrumb = { id: "home", label: "Trellis", select: home };
  const scopeCrumb: ChromeCrumb = {
    id: "scope",
    label:
      scope.kind === "workflow"
        ? (title ?? workflowId ?? "Workflow")
        : scope.kind === "schedules"
          ? "Schedules"
          : scope.kind === "templates"
            ? "Templates"
            : scope.kind === "all-workflows"
              ? "All workflows"
              : "All runs",
    siblings: [
      { id: "all-runs", label: "All runs" },
      { id: "schedules", label: "Schedules" },
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
      if (
        id === "all-runs" ||
        id === "templates" ||
        id === "all-workflows" ||
        id === "schedules"
      ) {
        go({ scope: { kind: id }, selectedRun: null });
        return;
      }
      const item = workflows.find((item) => `w${item.workflowId}` === id);
      if (item) choose(item.workflowId);
    },
  };
  // Runs is the home view and its tab is already showing, so it needs no
  // crumb of its own; every other scope and each workflow adds one.
  const crumbs: readonly ChromeCrumb[] = [
    trellis,
    ...(scope.kind === "all-runs" ? [] : [scopeCrumb]),
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
              go({ tool: id, selectedRun: null });
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
    history: {
      canGoBack,
      canGoForward,
      back: () => history.back(),
      forward: () => history.forward(),
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
      {!viewingSchedules && error ? (
        <div className="wf-page">
          <FailureLine message={error.message} onRetry={refreshLibrary} />
        </div>
      ) : null}
      {scope.kind !== "workflow" ? (
        <Tabs
          className="wf-sections"
          value={scope.kind}
          onValueChange={(id) => {
            scopeCrumb.select?.(id);
          }}
        >
          <TabsList aria-label="Trellis sections">
            {sections.map(({ id, label }) => (
              <TabsTrigger key={id} value={id}>
                {label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      ) : null}
      {needsGit &&
      (scope.kind === "all-runs" || scope.kind === "all-workflows") ? (
        <main className="wf-page wf-invitation">
          <SetupNotice
            variant="panel"
            need="Run a sequence of App steps"
            cause="Approve Git access to save and version your workflows."
            visual={<Sigil name="trellis" size={48} />}
            waitingFor="your approval"
            fix={{
              label: "Approve Git access",
              onSelect: approveGit,
              pending: approving,
            }}
          />
        </main>
      ) : null}
      {scope.kind === "all-workflows" && !needsGit ? (
        <main className="wf-page">
          <h1>All workflows</h1>
          {!library ? (
            <LoadingState
              message={
                slow
                  ? "Loading is taking longer than usual."
                  : "Loading workflows…"
              }
            />
          ) : null}
          {slow && !library ? (
            <Button
              variant="ghost"
              onClick={() => {
                setAttempt((value) => value + 1);
              }}
            >
              Retry
            </Button>
          ) : null}
          {library && !Array.isArray(library) ? (
            <LoadingState message="Finding your workflows…" />
          ) : null}
          {Array.isArray(library) && workflows.length === 0 ? (
            <Welcome
              client={client}
              onUse={choose}
              onBlank={() => void create()}
              creating={busy}
            />
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
            runPanel={(version, autoRun = false) => (
              <RunWorkflow
                key={version}
                client={client}
                workflowId={editorWorkflowId}
                version={version}
                autoRun={autoRun}
                onRun={(id) => {
                  go({ tool: "runs", selectedRun: id });
                }}
              />
            )}
          />
        ) : null}
      </div>
      {showWelcome ? (
        <Welcome
          client={client}
          onUse={choose}
          onBlank={() => void create()}
          creating={busy}
        />
      ) : null}
      {scope.kind === "all-runs" &&
      !needsGit &&
      !error &&
      !Array.isArray(library) ? (
        <main className="wf-page wf-invitation">
          <LoadingState
            message={
              library ? "Finding your workflows…" : "Opening your workflows…"
            }
          />
        </main>
      ) : null}
      {(scope.kind === "all-runs" &&
        Array.isArray(library) &&
        !needsGit &&
        !showWelcome) ||
      (scope.kind === "workflow" && tool === "runs") ? (
        <Runs
          client={client}
          workflowId={workflowId ?? undefined}
          selectedRun={selectedRun}
          onSelect={(id, owner) => {
            const place: Place = {
              scope: { kind: "workflow", workflowId: owner },
              tool: "runs",
              selectedRun: id,
            };
            const current = history.get().current;
            // Opening the run a deep link already selected only names its
            // workflow; it is not a new place to go back from.
            if (current.scope.kind === "all-runs" && current.selectedRun === id)
              history.replace(place);
            else history.push(place);
            setRecent((items) =>
              [owner, ...items.filter((item) => item !== owner)].slice(0, 12),
            );
            setAttempt((value) => value + 1);
          }}
          readMedia={readMedia}
          openIn={openIn}
          onOpenWorkflows={() => {
            go({ scope: { kind: "all-workflows" } });
          }}
          onOpenEditor={() => {
            go({ tool: "editor" });
          }}
        />
      ) : null}
      {scope.kind === "workflow" && tool === "triggers" ? (
        <Triggers
          client={client}
          workflowId={workflowId}
          onOpenEditor={() => {
            go({ tool: "editor" });
          }}
        />
      ) : null}
      {scope.kind === "templates" ? (
        <Templates
          client={client}
          onUse={choose}
          blockedReason={
            needsGit
              ? "Approve Git access first, so the workflow can be saved."
              : undefined
          }
        />
      ) : null}
      {viewingSchedules ? (
        <Schedules
          client={client}
          onOpenWorkflows={() => {
            go({ scope: { kind: "all-workflows" } });
          }}
        />
      ) : null}
    </>
  );
}
