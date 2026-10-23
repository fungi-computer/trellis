import { describeAppError } from "@fungi.computer/agar/errors";
import { FieldSet } from "@fungi.computer/caps/components/field";
import { Button } from "@fungi.computer/caps/components/button";
import {
  DataList,
  DataListHeading,
  DataRow,
} from "@fungi.computer/caps/components/data-list";
import { SearchInput } from "@fungi.computer/caps/components/input";
import { Surface } from "@fungi.computer/caps/components/surface";
import { WorkflowMark } from "./mark.js";
import { Status } from "@fungi.computer/caps/components/status";
import { ReactFlowProvider, useReactFlow } from "@xyflow/react";
import { validate, type Node, type PortRef } from "@fungi.computer/braid";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { EditorPanes, type EditorPane } from "./panes.js";
import { WorkflowCanvas } from "./canvas.js";
import {
  graphDraft,
  replaceGraphDraft,
  type NodeAddress,
} from "./graph-address.js";
import { addNode, connect, removeNode } from "./graph.js";
import { Inspector } from "./inspector.js";
import { useDraft } from "./use-draft.js";
import type { Draft, DraftStore } from "./draft-store.js";
import {
  PublicationObservationTimeout,
  publicationFailureCopy,
} from "./draft-store.js";
import { createCodeNode } from "./code-node.js";
import { versionRelativeTime } from "../history/relative-time.js";
import { CatalogLoadingProvider } from "./catalog-loading.js";
import { useChrome, type ChromeParts } from "../chrome.js";
import "./editor.css";

export type WorkflowEditorProps = {
  store: DraftStore;
  runPanel?: (version: number | undefined) => ReactNode;
  /** Only the editor on screen adds its crumbs and commands to the header. */
  active: boolean;
};
/** Adds the editor's version crumb, commands and status to the header. */
function ChromeSlot({
  active,
  parts,
}: {
  active: boolean;
  parts: ChromeParts;
}) {
  useChrome("editor", active ? parts : null);
  return null;
}
function Editor({ store, runPanel, active }: WorkflowEditorProps) {
  const state = useDraft(store);
  const runHintId = useId();
  const [publishing, setPublishing] = useState(false);
  const publication = useRef<AbortController | null>(null);
  const [confirmRestore, setConfirmRestore] = useState(false);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(Date.now());
    }, 60_000);
    return () => {
      window.clearInterval(timer);
    };
  }, []);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [publicationPaused, setPublicationPaused] = useState(false);
  const [publishedVersion, setPublishedVersion] = useState<number | null>(null);
  useEffect(() => {
    setPublishing(false);
    setPublishError(null);
    setPublicationPaused(false);
    setPublishedVersion(null);
    return () => {
      publication.current?.abort();
    };
  }, [store]);
  const [selected, setSelected] = useState<NodeAddress | null>(null);
  const [pane, setPane] = useState<EditorPane>("palette");
  const [reveal, setReveal] = useState(0);
  const [query, setQuery] = useState("");
  const [refusal, setRefusal] = useState<string | null>(null);
  const flow = useReactFlow();
  const runVersion =
    state.version ?? publishedVersion ?? state.versions.at(0)?.version;
  const readOnly = state.version !== undefined;
  const viewedVersion = state.versions.find(
    (version) => version.version === state.version,
  );
  const document = readOnly ? state.published : state.document;
  const draft = readOnly ? state.published?.draft : state.draft;
  const loading = !draft || !document;
  const failed = state.error !== null || state.versionError !== null;
  const [slow, setSlow] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  useEffect(() => {
    setSlow(false);
    if (!loading || failed) return;
    const timer = window.setTimeout(() => {
      setSlow(true);
    }, 5000);
    return () => {
      window.clearTimeout(timer);
    };
  }, [loading, failed, store, state.version, loadAttempt]);
  const chooseVersion = (value: string) => {
    setSelected(null);
    setConfirmRestore(false);
    state.setVersion(value === "draft" ? undefined : Number(value));
  };
  // Navigation describes the selected Item, not whether its content has loaded.
  const navigation: ChromeParts = {
    back: {
      can: readOnly && !state.restoring,
      go: () => {
        chooseVersion("draft");
      },
    },
    crumbs: [
      {
        id: "version",
        label: readOnly ? `v${String(state.version)}` : "Draft",
        siblings: [
          { id: "draft", label: "Current draft" },
          ...state.versions.map((item) => ({
            id: String(item.version),
            label:
              `v${String(item.version)} · ${item.title} · ${versionRelativeTime(item.createdAt, now)}`.slice(
                0,
                80,
              ),
          })),
        ],
        select: (sibling) => {
          if (sibling !== undefined && !state.restoring) chooseVersion(sibling);
        },
      },
    ],
  };
  if (!draft || !document)
    return (
      <main className="wf-pane-body">
        <ChromeSlot active={active} parts={navigation} />
        <Status
          label={failed ? "Workflow could not be loaded" : "Loading workflow…"}
          tone={failed ? "error" : "neutral"}
        />
        {failed || slow ? (
          <p role="status">
            {failed
              ? "Try loading this workflow again."
              : "Loading this workflow is taking longer than usual. You can keep waiting or retry."}
            <Button
              variant="ghost"
              onClick={() => {
                setSlow(false);
                setLoadAttempt((attempt) => attempt + 1);
                if (readOnly) state.setVersion(undefined);
                else state.reload();
              }}
            >
              {readOnly ? "Return to draft" : "Retry"}
            </Button>
          </p>
        ) : null}
      </main>
    );
  const catalog = state.document?.catalog ?? document.catalog;
  const catalogUnavailable =
    state.catalogLoading || state.catalogError !== null;
  const issues = catalogUnavailable ? [] : validate(draft.definition, catalog);
  const update = (next: Draft) => {
    if (!readOnly) state.setDraft(next);
  };
  const connectPorts = (graphId: string, from: PortRef, to: PortRef) => {
    if (readOnly) return;
    const scoped = graphDraft(draft, graphId);
    if (!scoped) return;
    const result = connect(scoped, catalog, from, to);
    if (result.ok) {
      update(replaceGraphDraft(draft, graphId, result.draft));
      setRefusal(null);
    } else setRefusal(result.message);
  };
  const choose = (address: NodeAddress | null) => {
    setSelected(address);
    setPane("node");
    setReveal((value) => value + 1);
  };
  const remove = ({ graphId, nodeId }: NodeAddress) => {
    if (readOnly) return;
    state.setDraft((current) => {
      if (!current) return current;
      const scoped = graphDraft(current, graphId);
      return scoped
        ? replaceGraphDraft(current, graphId, removeNode(scoped, nodeId))
        : current;
    });
    setSelected(null);
  };
  const nextId = (scoped: Draft) => {
    let index = 1;
    while (
      scoped.definition.nodes.some((node) => node.id === `node${String(index)}`)
    )
      index += 1;
    return `node${String(index)}`;
  };
  const entries = [
    ...Object.entries(document.palette).flatMap(([appId, methods]) =>
      Object.entries(methods).map(([method, spec]) => ({
        key: `${appId}/${method}`,
        group: appId,
        name: method,
        description: spec.description,
        create: (id: string): Node => ({
          id,
          kind: "app",
          app:
            Object.entries(draft.definition.apps).find(
              ([, app]) => app.appId === appId,
            )?.[0] ?? id,
          method,
          methodDigest: spec.digest,
          values: {},
        }),
        appId,
      })),
    ),
    {
      key: "review",
      group: "Control",
      name: "Review",
      description: "Pause for a human decision",
      create: (id: string): Node => ({
        id,
        kind: "review",
        title: "Keep this result?",
        show: [],
        reviewers: "runner",
        timeout: 86400000,
      }),
      appId: null,
    },
    {
      key: "wait",
      group: "Control",
      name: "Wait",
      description: "Wait before continuing",
      create: (id: string): Node => ({ id, kind: "wait", for: 1000 }),
      appId: null,
    },
    {
      key: "condition",
      group: "Control",
      name: "Condition",
      description: "Choose a branch",
      create: (id: string): Node => ({
        id,
        kind: "condition",
        test: { op: "exists", value: { literal: null } },
      }),
      appId: null,
    },
    {
      key: "map",
      group: "Control",
      name: "Map",
      description: "Apply a graph to each item",
      create: (id: string): Node => ({
        id,
        kind: "map",
        over: { node: "$input", port: "items" },
        body: `${id}Body`,
        concurrency: 1,
        maxItems: 10,
      }),
      appId: null,
    },
    {
      key: "repeat",
      group: "Control",
      name: "Repeat",
      description: "Revise an item until a stop condition is met",
      create: (id: string): Node => ({
        id,
        kind: "repeat",
        body: `${id}Body`,
        maxRounds: 3,
        until: {
          op: "exists",
          value: { from: { node: "$input", port: "result" } },
        },
      }),
      appId: null,
    },
    {
      key: "transform",
      group: "Control",
      name: "Transform",
      description: "Shape values without code",
      create: (id: string): Node => ({ id, kind: "transform", fields: {} }),
      appId: null,
    },
    {
      key: "code",
      group: "Control",
      name: "Code",
      description: "Reshape mapped JSON",
      create: createCodeNode,
      appId: null,
    },
  ];
  const add = (key: string, point?: { x: number; y: number }) => {
    if (readOnly) return;
    const entry = entries.find((item) => item.key === key);
    if (!entry) return;
    const graphId = selected?.graphId ?? "root";
    const scoped = graphDraft(draft, graphId);
    if (!scoped) return;
    if (scoped.definition.nodes.length >= 64) {
      setRefusal("A workflow can contain at most 64 nodes.");
      return;
    }
    const node = entry.create(nextId(scoped));
    let next = addNode(
      scoped,
      node,
      point ?? {
        x: ((scoped.definition.nodes.length + 1) % 2) * 360,
        y: Math.floor((scoped.definition.nodes.length + 1) / 2) * 210 + 40,
      },
    );
    if (node.kind === "app" && entry.appId)
      next = {
        ...next,
        definition: {
          ...next.definition,
          apps: { ...next.definition.apps, [node.app]: { appId: entry.appId } },
        },
      };
    if (node.kind === "map" || node.kind === "repeat")
      next = {
        ...next,
        definition: {
          ...next.definition,
          subgraphs: {
            ...next.definition.subgraphs,
            [node.body]: {
              input: {
                type: "object",
                properties:
                  node.kind === "map"
                    ? { item: {}, index: { type: "integer" } }
                    : {
                        item: {},
                        round: {
                          type: "integer",
                          minimum: 0,
                          maximum: node.maxRounds - 1,
                        },
                        previous: { type: "object" },
                      },
                required:
                  node.kind === "map"
                    ? ["item", "index"]
                    : ["item", "round", "previous"],
                additionalProperties: false,
              },
              nodes: [],
              edges: [],
              output: {},
            },
          },
        },
      };
    update(replaceGraphDraft(draft, graphId, next));
    choose({ graphId, nodeId: node.id });
  };
  const shown = entries.filter((entry) =>
    `${document.appDisplay[entry.group]?.displayName ?? entry.group} ${entry.name} ${entry.description}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  const publish = () => {
    if (!store.publish || (publicationPaused && !store.checkPublication))
      return;
    setPublishing(true);
    setPublishError(null);
    const controller = new AbortController();
    publication.current = controller;
    const observation =
      publicationPaused && store.checkPublication
        ? store.checkPublication(controller.signal)
        : store.publish(document.revision, controller.signal);
    setPublicationPaused(false);
    void observation
      .then(
        (version) => {
          if (controller.signal.aborted) return;
          setPublicationPaused(false);
          setPublishedVersion(version);
          state.refreshHistory();
          state.refreshCatalog();
        },
        (cause: unknown) => {
          if (controller.signal.aborted) return;
          setPublicationPaused(cause instanceof PublicationObservationTimeout);
          setPublishError(
            publicationFailureCopy(cause) ??
              describeAppError(cause, {
                CONFLICT: {
                  title: "Draft changed",
                  message:
                    "Couldn't publish: this draft changed in another window. Reload to see it.",
                },
                INVALID_ARGUMENT: {
                  title: "Invalid draft",
                  message:
                    "Couldn't publish: this draft has validation issues. Fix them before publishing.",
                },
                HOST_FAILURE: {
                  title: "Publication failed",
                  message:
                    "Couldn't publish: the service couldn't complete this request.",
                },
              }).message,
          );
        },
      )
      .finally(() => {
        if (!controller.signal.aborted) setPublishing(false);
      });
  };
  const savedLabel = readOnly
    ? `Version ${String(state.version)} · read only${viewedVersion ? ` · ${viewedVersion.commit.slice(0, 7)}` : ""}`
    : document.durability === "memory"
      ? "Unsaved · this window only"
      : issues.length && state.draft !== state.document?.draft
        ? "Not saved · fix issues"
        : state.saving
          ? "Saving…"
          : state.error ||
              state.conflict ||
              state.draft !== state.document?.draft
            ? "Not saved"
            : "Saved";
  const publishDisabled =
    publishing ||
    (!publicationPaused &&
      (state.saving ||
        state.conflict ||
        !!state.error ||
        catalogUnavailable ||
        issues.length > 0 ||
        state.draft !== state.document?.draft));
  const validLabel = state.catalogLoading
    ? "Loading Apps…"
    : state.catalogError
      ? "Not checked"
      : issues.length
        ? `${String(issues.length)} issues`
        : "Valid";
  // Hide only healthy, settled labels. Pending/unsaved/error states retain
  // visible explanations rather than reducing a refusal to an ambiguous dot.
  let savedStatus: NonNullable<ChromeParts["status"]>[number] = {
    id: "saved",
    label: savedLabel,
    tone: savedLabel === "Saved" ? "success" : "neutral",
  };
  if (savedLabel === "Saved")
    savedStatus = { ...savedStatus, presentation: "bead" };
  let validStatus: NonNullable<ChromeParts["status"]>[number] = {
    id: "valid",
    label: validLabel,
    tone: catalogUnavailable ? "neutral" : issues.length ? "error" : "success",
  };
  if (validLabel === "Valid")
    validStatus = { ...validStatus, presentation: "bead" };
  const chromeParts: ChromeParts = {
    ...navigation,
    primary: [
      ...(runPanel
        ? [
            {
              id: "run",
              label: "Run",
              icon: "play" as const,
              variant: "ghost" as const,
              disabled: runVersion === undefined,
              run: () => {
                setPane(pane === "run" ? "node" : "run");
                setReveal((value) => value + 1);
              },
            },
          ]
        : []),
      ...(readOnly && store.restore
        ? [
            {
              id: "restore",
              label: "Restore as draft",
              variant: "primary" as const,
              disabled: state.saving || state.restoring || state.conflict,
              run: () => {
                setConfirmRestore(true);
              },
            },
          ]
        : store.publish && !readOnly
          ? [
              {
                id: "publish",
                label: publishing
                  ? "Publishing…"
                  : publicationPaused
                    ? "Check status"
                    : publishError
                      ? "Try again"
                      : "Publish",
                variant: "primary" as const,
                disabled: publishDisabled,
                run: publish,
              },
            ]
          : []),
    ],
    status: [savedStatus, validStatus],
  };
  const notes = [
    state.historyError,
    state.restoreNotice,
    state.restoreError,
    publishError,
    confirmRestore,
    runPanel !== undefined && runVersion === undefined,
  ].some(Boolean);
  return (
    <main className="wf-editor" data-mode="build" data-pane={pane}>
      <CatalogLoadingProvider value={state.catalogLoading}>
        <ChromeSlot active={active} parts={chromeParts} />
        {notes ? (
          <header className="wf-bar">
            {state.historyError ? (
              <p role="alert" className="wf-bar-note">
                Version history could not be loaded.
              </p>
            ) : null}
            {readOnly && store.restore && confirmRestore ? (
              <span className="wf-bar-restore-confirm">
                <p>Replace the current draft with v{state.version}?</p>
                <Button
                  size="sm"
                  disabled={state.saving || state.restoring}
                  onClick={() => {
                    setSelected(null);
                    setConfirmRestore(false);
                    void state.restoreVersion();
                  }}
                >
                  Confirm restore
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={state.restoring}
                  onClick={() => {
                    setConfirmRestore(false);
                  }}
                >
                  Cancel
                </Button>
              </span>
            ) : null}
            {state.restoreNotice ? (
              <p role="status" className="wf-bar-note">
                {state.restoreNotice}
              </p>
            ) : null}
            {state.restoreError ? (
              <p role="alert" className="wf-bar-note">
                {state.restoreError}
              </p>
            ) : null}
            {publishError ? (
              <p
                role={publicationPaused ? "status" : "alert"}
                className="wf-bar-note"
              >
                {publishError}
              </p>
            ) : null}
            {runPanel && runVersion === undefined ? (
              <p id={runHintId} className="wf-muted wf-bar-note">
                Publish a version to run this workflow.
              </p>
            ) : null}
          </header>
        ) : null}
        <EditorPanes
          active={active}
          pane={pane}
          reveal={reveal}
          palette={
            <nav className="wf-pane-body" aria-label="Node palette">
              {state.catalogError ? (
                <p role="alert">
                  App catalog could not be loaded. Your draft is still
                  available.
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={state.refreshCatalog}
                  >
                    Retry catalog
                  </Button>
                </p>
              ) : null}
              <SearchInput
                aria-label="Find a node"
                placeholder="Find a method…"
                value={query}
                onChange={(event) => {
                  setQuery(event.currentTarget.value);
                }}
              />
              {Object.keys(document.palette).length === 0 ? (
                <p className="wf-muted">
                  App methods will appear when the installed App catalog is
                  connected.
                </p>
              ) : null}
              {[...new Set(shown.map((entry) => entry.group))].map((group) => (
                <section key={group}>
                  <DataListHeading level={3}>
                    <span className="flex items-center gap-xs">
                      {document.appDisplay[group] ? (
                        <WorkflowMark
                          appIcon={document.appDisplay[group].icon}
                          appName={document.appDisplay[group].displayName}
                          kind="app"
                        />
                      ) : null}
                      {document.appDisplay[group]?.displayName ?? group}
                    </span>
                  </DataListHeading>
                  <DataList density="compact">
                    {shown
                      .filter((entry) => entry.group === group)
                      .map((entry) => (
                        <DataRow key={entry.key} className="block">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="wf-palette-entry h-auto w-full min-w-0 cursor-grab items-start justify-start gap-xs whitespace-normal text-start"
                            disabled={readOnly}
                            draggable={!readOnly}
                            onDragStart={(event) => {
                              event.dataTransfer.setData(
                                "application/x-fungi-node",
                                entry.key,
                              );
                            }}
                            onClick={() => {
                              add(entry.key);
                            }}
                          >
                            <WorkflowMark
                              appIcon={
                                entry.appId
                                  ? document.appDisplay[entry.appId]?.icon
                                  : undefined
                              }
                              appName={
                                document.appDisplay[entry.group]?.displayName ??
                                entry.group
                              }
                              kind={entry.appId ? "app" : entry.key}
                            />
                            <span className="grid min-w-0 gap-2xs">
                              <span>{entry.name}</span>
                              <span
                                className="wf-muted line-clamp-2 font-normal"
                                title={entry.description}
                              >
                                {entry.description}
                              </span>
                            </span>
                          </Button>
                        </DataRow>
                      ))}
                  </DataList>
                </section>
              ))}
            </nav>
          }
          canvas={
            <WorkflowCanvas
              key={state.version ?? "draft"}
              readOnly={readOnly}
              draft={draft}
              catalog={catalog}
              appDisplay={document.appDisplay}
              issues={issues}
              selected={selected}
              onSelect={choose}
              onMove={(id, position) => {
                if (readOnly) return;
                state.setDraft((current) =>
                  current
                    ? {
                        ...current,
                        layout: { ...current.layout, [id]: position },
                      }
                    : current,
                );
              }}
              onConnect={(from, to) => {
                connectPorts("root", from, to);
              }}
              onRemove={(nodeId) => {
                remove({ graphId: "root", nodeId });
              }}
              onDisconnect={(index) => {
                if (readOnly) return;
                const removed = draft.definition.edges[index];
                state.setDraft((current) =>
                  current
                    ? {
                        ...current,
                        definition: {
                          ...current.definition,
                          edges: current.definition.edges.filter(
                            (edge) => edge !== removed,
                          ),
                        },
                      }
                    : current,
                );
              }}
              onDrop={(key, point) => {
                add(key, flow.screenToFlowPosition(point));
              }}
            />
          }
          inspector={
            pane === "run" && runPanel ? (
              <div className="wf-pane-body">{runPanel(runVersion)}</div>
            ) : (
              <FieldSet
                legend={
                  <span className="sr-only">
                    {selected ? "Node" : "Workflow"}
                  </span>
                }
                disabled={readOnly}
                className="wf-inspector-fields"
              >
                <Inspector
                  key={selected ? JSON.stringify(selected) : "workflow"}
                  draft={draft}
                  catalog={catalog}
                  appDisplay={state.document?.appDisplay ?? document.appDisplay}
                  selected={selected}
                  issues={issues}
                  onChange={update}
                  onRemove={remove}
                  onConnect={connectPorts}
                />
              </FieldSet>
            )
          }
        />
        {refusal || state.error || state.conflict ? (
          <Surface
            role="alert"
            placement="embedded"
            size="sm"
            className="wf-refusal"
          >
            {refusal ??
              (state.conflict
                ? "This draft changed elsewhere. Your edits are still in this window; discard your local edits to open the latest draft."
                : "Draft could not be saved. Your edits remain in this window.")}
            {state.conflict ? (
              <Button
                variant="ghost"
                disabled={state.saving}
                onClick={state.reload}
              >
                Discard local edits and reload
              </Button>
            ) : state.error ? (
              <Button variant="ghost" onClick={state.retrySave}>
                Retry save
              </Button>
            ) : null}
          </Surface>
        ) : null}
      </CatalogLoadingProvider>
    </main>
  );
}
export function WorkflowEditor(props: WorkflowEditorProps) {
  return (
    <ReactFlowProvider>
      <Editor {...props} />
    </ReactFlowProvider>
  );
}
