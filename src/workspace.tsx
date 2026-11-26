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
import { Button } from "@fungi.computer/caps/components/button";
import { Toaster, toast } from "@fungi.computer/caps/components/toaster";
import { Sigil } from "@fungi.computer/sigils";
import {
  Tabs,
  TabsList,
  TabsTrigger,
} from "@fungi.computer/caps/components/tabs";
import { useChrome, type ChromeCrumb } from "./chrome.js";
import { WorkflowEditor } from "./editor/editor.js";
import {
  AskAgent,
  type AskTarget,
  type ToastAction,
} from "./agent/ask-agent.js";
import { rowDraftStore } from "./editor/row-draft-store.js";
import { Runs } from "./runs/runs.js";
import { RunWorkflow } from "./runs/run-workflow.js";
import type { ReadMedia } from "./runs/output-preview.js";
import type { OpenInApp } from "./runs/run-timeline.js";
import { Triggers } from "./triggers/triggers.js";
import { Templates } from "./templates/templates.js";
import { Schedules } from "./schedules/schedules.js";
import { FirstRun, type StartKind } from "./first-run.js";
import {
  WorkflowsHome,
  WorkflowsHomeLoading,
} from "./workflows/workflows-home.js";
import { useWorkflowRows } from "./workflows/use-workflow-rows.js";
import type { WorkflowClient } from "./workflow-client.js";
import type { AppOpenRequest } from "@fungi.computer/agar";
import { workflowIdSchema } from "@fungi.computer/braid";
/** The Toaster that shows toasts with an action beside them. */
const actionToaster = "trellis-actions";
/**
 * A host refusal for an ungranted capability. It crosses the App's RPC as a
 * plain Error carrying the host AppError's own `code`, never as an AppError.
 */
const capabilityDenied = z.object({ code: z.literal("CAPABILITY_DENIED") });
/** The tool row of an open workflow, in the order it is shown. */
const tools = [
  { id: "canvas", label: "Canvas" },
  { id: "runs", label: "Runs" },
  { id: "triggers", label: "Triggers" },
] as const;
type Tool = (typeof tools)[number]["id"];
export type WorkflowScope =
  | {
      kind: "all-runs" | "templates" | "all-workflows" | "schedules" | "new";
    }
  | { kind: "workflow"; workflowId: string };
/** One place in Trellis: what Back and Forward move between. */
type Place = Readonly<{
  scope: WorkflowScope;
  tool: Tool;
  selectedRun: string | null;
}>;

export function WorkflowWorkspace({
  client,
  initialScope = { kind: "all-workflows" },
  readMedia,
  openIn,
  browserActions,
  permissions,
  notify,
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
  /** Where a failure is told: one toast, never a line that moves the page. */
  notify?: Pick<HostUi, "showToast">;
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
      tool: "canvas",
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
  // Triggers edit the same draft, so the canvas reads it again afterwards.
  const [canvasReads, setCanvasReads] = useState(0);
  const [shareDialog, setShareDialog] = useState<ShareDialog | null>(null);
  // The Ask an Agent panel, and the chat an Agent is building in right now.
  const [askOpen, setAskOpen] = useState(false);
  const [building, setBuilding] = useState<{
    workflowId: string;
    target: AskTarget;
  } | null>(null);
  // Agent names by id, so the canvas can say who added a step.
  const [agentNames, setAgentNames] = useState<
    Readonly<Record<string, string>>
  >({});
  useEffect(() => {
    let active = true;
    void client.listScheduleAgents().then(
      (agents) => {
        if (active)
          setAgentNames(
            Object.fromEntries(
              agents.map(({ agentId, name }) => [agentId, name]),
            ),
          );
      },
      (cause: unknown) => {
        // Names are a courtesy: marks and summaries fall back to "an Agent".
        console.error("Agent names could not be read", cause);
      },
    );
    return () => {
      active = false;
    };
  }, [client]);
  const [error, setError] = useState<Error | null>(null);
  // Git access is asked for in use, never at install: until the owner
  // approves it the library cannot be read, which is not a failure.
  const [needsGit, setNeedsGit] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [slow, setSlow] = useState(false);
  const handledRequest = useRef<{
    client: WorkflowClient;
    requestId: string;
  } | null>(null);
  const choose = useCallback(
    (id: string, tool: Tool = "canvas") => {
      history.push({
        scope: { kind: "workflow", workflowId: id },
        tool,
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
  /** A failure is told once, as a toast; without a host to show one it heads the page. */
  const fail = useCallback(
    (message: string) => {
      if (notify) void notify.showToast({ message, tone: "error" });
      else setError(new Error(message));
    },
    [notify],
  );
  /** One action beside a toast ("Allow"): the host's toast takes only words. */
  const offer = useCallback((message: string, action: ToastAction) => {
    const id = toast.error(message, {
      toasterId: actionToaster,
      closeButton: true,
      duration: action.persistent ? Infinity : undefined,
      action: { label: action.label, onClick: action.onSelect },
    });
    return () => {
      toast.dismiss(id);
    };
  }, []);
  const create = useCallback(() => {
    go({ scope: { kind: "new" }, selectedRun: null });
  }, [go]);
  const workflows = useMemo(
    () => (Array.isArray(library) ? library : []),
    [library],
  );
  const {
    rows,
    failure: rowsFailure,
    setOn,
  } = useWorkflowRows(client, workflows, attempt);
  useEffect(() => {
    if (rowsFailure !== null) fail(rowsFailure);
  }, [rowsFailure, fail]);
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
    go({ scope: { kind: "all-workflows" }, tool: "canvas", selectedRun: null });
  };
  // A Team with no workflows opens on a blank canvas, not an empty table.
  const firstRun =
    (scope.kind === "all-workflows" || scope.kind === "new") &&
    !needsGit &&
    !error &&
    (scope.kind === "new" ||
      (Array.isArray(library) && workflows.length === 0));
  const sections = [
    { id: "all-workflows", label: "Workflows" },
    { id: "all-runs", label: "Runs" },
    { id: "templates", label: "Templates" },
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
            : scope.kind === "new"
              ? "New workflow"
              : scope.kind === "all-workflows"
                ? "Workflows"
                : "All runs",
    siblings: [
      { id: "all-workflows", label: "Workflows" },
      { id: "all-runs", label: "All runs" },
      { id: "schedules", label: "Schedules" },
      { id: "templates", label: "Templates" },
      ...recent.flatMap((id) => {
        const item = workflows.find((item) => item.workflowId === id);
        // One-character namespace preserves Agar's 64-character id bound.
        return item ? [{ id: `w${id}`, label: item.title }] : [];
      }),
      { id: "new", label: "New workflow" },
    ],
    select: (id) => {
      if (id === undefined) return;
      if (id === "new") {
        create();
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
  // Workflows is the home view and its tab is already showing, so it needs no
  // crumb of its own; every other scope and each workflow adds one.
  const crumbs: readonly ChromeCrumb[] = [
    trellis,
    ...(scope.kind === "all-workflows" ? [] : [scopeCrumb]),
  ];
  const editing = scope.kind === "workflow" && tool === "canvas";
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
        run: create,
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
      <Toaster id={actionToaster} />
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
      {scope.kind !== "workflow" && scope.kind !== "new" ? (
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
      {scope.kind === "workflow" ? (
        <div className="wf-sections-row">
          <Tabs
            className="wf-sections"
            value={tool}
            onValueChange={(id) => {
              const next = tools.find((item) => item.id === id);
              if (next) go({ tool: next.id, selectedRun: null });
            }}
          >
            <TabsList aria-label="Workflow tools">
              {tools.map(({ id, label }) => (
                <TabsTrigger key={id} value={id}>
                  {label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          {editing ? (
            <Button
              className="wf-ask-toggle"
              size="sm"
              variant="outline"
              aria-expanded={askOpen || building !== null}
              disabled={building !== null}
              onClick={() => {
                setAskOpen((open) => !open);
              }}
            >
              Ask an Agent
            </Button>
          ) : null}
        </div>
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
      {scope.kind === "all-workflows" &&
      !needsGit &&
      !error &&
      !Array.isArray(library) ? (
        <WorkflowsHomeLoading
          slow={slow && !library}
          finding={library !== null}
          onRetry={refreshLibrary}
        />
      ) : null}
      {scope.kind === "all-workflows" &&
      !needsGit &&
      Array.isArray(library) &&
      workflows.length > 0 ? (
        <WorkflowsHome
          rows={rows}
          creating={false}
          actions={{
            open: (id) => {
              choose(id);
            },
            openRun: (owner, run) => {
              history.push({
                scope: { kind: "workflow", workflowId: owner },
                tool: "runs",
                selectedRun: run,
              });
              setAttempt((value) => value + 1);
            },
            setOn,
            create,
            fail,
          }}
        />
      ) : null}
      <div className="wf-editor-host" hidden={!editing}>
        {editing && workflowId !== null && (askOpen || building !== null) ? (
          <AskAgent
            client={client}
            workflowId={workflowId}
            building={
              building?.workflowId === workflowId ? building.target : null
            }
            onBuilding={(target, id) => {
              setBuilding(target === null ? null : { workflowId: id, target });
            }}
            permissions={permissions}
            notify={fail}
            offer={offer}
            onClose={
              building === null
                ? () => {
                    setAskOpen(false);
                  }
                : undefined
            }
          />
        ) : null}
        {store && editorWorkflowId ? (
          <WorkflowEditor
            key={`${editorWorkflowId}:${String(canvasReads)}`}
            store={store}
            active={editing}
            test={{ client, workflowId: editorWorkflowId }}
            notify={fail}
            offer={offer}
            {...(permissions ? { permissions } : {})}
            agentNames={agentNames}
            asking={askOpen || building !== null}
            {...(readMedia ? { readMedia } : {})}
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
      {firstRun ? (
        <FirstRun
          key={scope.kind}
          client={client}
          permissions={permissions}
          offer={offer}
          onCreated={(id, kind: StartKind | null, started) => {
            choose(id, kind === "event" ? "triggers" : "canvas");
            if (started) {
              setBuilding({ workflowId: id, target: started });
              setAskOpen(true);
            }
          }}
          onTemplates={() => {
            go({ scope: { kind: "templates" }, selectedRun: null });
          }}
          onFail={fail}
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
      {(scope.kind === "all-runs" && Array.isArray(library) && !needsGit) ||
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
            go({ tool: "canvas" });
          }}
          onAsk={(owner) => {
            choose(owner, "canvas");
            setAskOpen(true);
          }}
        />
      ) : null}
      {scope.kind === "workflow" && tool === "triggers" ? (
        <Triggers
          client={client}
          workflowId={workflowId}
          store={store}
          onOpenCanvas={() => {
            go({ tool: "canvas" });
          }}
          onChanged={() => {
            setCanvasReads((value) => value + 1);
          }}
        />
      ) : null}
      {scope.kind === "templates" ? (
        <Templates
          client={client}
          onUse={choose}
          onFail={fail}
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
