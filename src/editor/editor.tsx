import { useAppHeaderRef } from "@fungi.computer/caps/components/app-header";
import { describeAppError } from "@fungi.computer/agar/errors";
import { FieldSet } from "@fungi.computer/caps/components/field";
import { Button } from "@fungi.computer/caps/components/button";
import { Surface } from "@fungi.computer/caps/components/surface";
import { LoadingState } from "@fungi.computer/caps/blocks/loading-state";
import { FailureLine } from "@fungi.computer/caps/components/failure-line";
import { ReactFlowProvider, useReactFlow } from "@xyflow/react";
import { validate, type Catalog, type PortRef } from "@fungi.computer/braid";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { ToastAction } from "../agent/ask-agent.js";
import { WorkflowCanvas, type CanvasPoint } from "./canvas.js";
import {
  disconnectStep,
  enteredView,
  issuesOfGraph,
  moveStep,
  useEnteredGraph,
  withFrames,
} from "./entered-graph.js";
import {
  graphDraft,
  replaceGraphDraft,
  type NodeAddress,
} from "./graph-address.js";
import { connect, removeNode } from "./graph.js";
import { Inspector } from "./inspector.js";
import { DraftDiffOverlay } from "./draft-diff-overlay.js";
import { nodePresentation } from "./graph-presentation.js";
import { useDraft } from "./use-draft.js";
import type { Draft, DraftStore } from "./draft-store.js";
import {
  PublicationObservationTimeout,
  publicationFailureCopy,
} from "./draft-store.js";
import { EditorLayout, type EditorView } from "./editor-layout.js";
import { editorChrome } from "./editor-chrome.js";
import { TestRunPanel } from "./test-run.js";
import { useTestRun, type TestTarget } from "./use-test-run.js";
import type { ReadMedia } from "../runs/output-preview.js";
import { PinMismatch, StepSearch } from "./step-search.js";
import {
  fitsPin,
  mismatchOffers,
  placeStep,
  stepEntries,
  type MismatchOffer,
  type StepEntry,
} from "./step-catalog.js";
import { versionRelativeTime } from "../history/relative-time.js";
import { CatalogLoadingProvider } from "./catalog-loading.js";
import { useChrome, type ChromeParts } from "../chrome.js";
import { loadCauseWords } from "./load-cause.js";
import "./editor.css";

export type WorkflowEditorProps = {
  store: DraftStore;
  runPanel?: (version: number | undefined, autoRun?: boolean) => ReactNode;
  /** Only the editor on screen adds its crumbs and commands to the header. */
  active: boolean;
  /** Where "Test workflow" runs the saved draft; without it there is no Test. */
  test?: TestTarget;
  readMedia?: ReadMedia;
  /** Tells the person something went wrong, once, as a toast. */
  notify?: (message: string) => void;
  /** A toast that stays with one action beside it; the returned call clears it. */
  offer?: (message: string, action: ToastAction) => () => void;
  /** Agent names by id, so a change reads "Added by Moss", not "Added". */
  agentNames?: Readonly<Record<string, string>>;
  /** The Ask an Agent panel is open: it says what to do next, so the hint waits. */
  asking?: boolean;
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
/** Where a step is being added, and the pin it was dragged from, if any. */
type SearchRequest = Readonly<{ point: CanvasPoint; from?: PortRef }>;
/** A wire the types refused, with what can be done about it. */
type PinIssue = Readonly<{
  point: CanvasPoint;
  message: string;
  offers: readonly MismatchOffer[];
}>;
function Editor({
  store,
  runPanel,
  active,
  test: testTarget,
  readMedia,
  notify,
  offer,
  agentNames,
  asking = false,
}: WorkflowEditorProps) {
  const headerRef = useAppHeaderRef();
  const state = useDraft(store);
  // An undo that fails says why in one toast; without a host it stays a line.
  const { restoreError } = state;
  useEffect(() => {
    if (restoreError && notify) notify(restoreError);
  }, [restoreError, notify]);
  // A catalog that will not load stays one toast with Retry until it loads or
  // is dismissed; the header's status keeps saying so after.
  const { catalogError } = state;
  const refreshCatalog = useRef(state.refreshCatalog);
  refreshCatalog.current = state.refreshCatalog;
  useEffect(() => {
    if (catalogError === null || !offer) return undefined;
    return offer(
      `App catalog could not be loaded: ${loadCauseWords(catalogError)} Your draft is still available.`,
      {
        label: "Retry catalog",
        onSelect: () => {
          refreshCatalog.current();
        },
        persistent: true,
      },
    );
  }, [catalogError, offer]);
  const test = useTestRun({
    target: testTarget,
    definition: state.document?.draft.definition,
    revision: state.document?.revision,
  });
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
  const [autoRunVersion, setAutoRunVersion] = useState<number | null>(null);
  useEffect(() => {
    setPublishing(false);
    setPublishError(null);
    setPublicationPaused(false);
    setPublishedVersion(null);
    setAutoRunVersion(null);
    return () => {
      publication.current?.abort();
    };
  }, [store]);
  const [selected, setSelected] = useState<NodeAddress | null>(null);
  const inside = useEnteredGraph();
  const [view, setView] = useState<EditorView>("canvas");
  const [showRun, setShowRun] = useState(false);
  const [search, setSearch] = useState<SearchRequest | null>(null);
  const [searchNote, setSearchNote] = useState<string | null>(null);
  const [pinCatalog, setPinCatalog] = useState<Catalog | null>(null);
  const [pinCatalogFailed, setPinCatalogFailed] = useState(false);
  const [pinIssue, setPinIssue] = useState<PinIssue | null>(null);
  const root = useRef<HTMLElement>(null);
  const flow = useReactFlow();
  const runVersion =
    state.version ?? publishedVersion ?? state.versions.at(0)?.version;
  const readOnly = state.version !== undefined;
  const unchangedPublished = state.matchingPublishedVersion !== undefined;
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
  // A wire dragged off a pin can only be matched against Apps whose ports are
  // known, and the draft loads just the Apps it names: ask for every App's.
  const palette = document?.palette;
  useEffect(() => {
    setPinCatalog(null);
    setPinCatalogFailed(false);
    if (!search?.from || !palette) return;
    let live = true;
    store.readCatalog(Object.keys(palette)).then(
      (loaded) => {
        if (live) setPinCatalog(loaded.catalog);
      },
      () => {
        if (live) setPinCatalogFailed(true);
      },
    );
    return () => {
      live = false;
    };
  }, [search, store, palette]);
  const entries = useMemo(
    () => (palette && draft ? stepEntries(palette, draft.definition.apps) : []),
    [palette, draft],
  );
  const searchCatalog = useMemo<Catalog>(
    () => ({ ...document?.catalog, ...pinCatalog }),
    [document?.catalog, pinCatalog],
  );
  const fits = useMemo(
    () =>
      search?.from && draft && pinCatalog
        ? fitsPin(
            graphDraft(draft, inside.entered) ?? draft,
            searchCatalog,
            entries,
            search.from,
          )
        : undefined,
    [search, draft, inside.entered, pinCatalog, searchCatalog, entries],
  );
  const chooseVersion = (value: string) => {
    setAutoRunVersion(null);
    setSelected(null);
    setConfirmRestore(false);
    state.setVersion(value === "draft" ? undefined : Number(value));
  };
  // Navigation describes the selected Item, not whether its content has loaded.
  const navigation: ChromeParts = {
    crumbs: [
      {
        id: "version",
        label: readOnly
          ? `v${String(state.version)}`
          : unchangedPublished
            ? `v${String(state.matchingPublishedVersion)}`
            : "Draft",
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
        {failed ? (
          <FailureLine
            message={`Workflow could not be loaded: ${loadCauseWords(state.error ?? state.versionError ?? { kind: "unexpected" })}`}
            retryLabel={readOnly ? "Return to draft" : "Retry"}
            onRetry={() => {
              if (readOnly) state.setVersion(undefined);
              else state.reload();
            }}
          />
        ) : (
          <LoadingState message="Loading workflow…" />
        )}
        {!failed && slow ? (
          <p role="status">
            Loading this workflow is taking longer than usual. You can keep
            waiting or retry.
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
  const scope = enteredView(
    draft,
    inside.entered,
    catalog,
    document.appDisplay,
  );
  // The Agent's diff marks the root canvas; inside a loop the loop step itself
  // is marked, and a published version on show is never diffed.
  const shownChange =
    !readOnly && scope.graphId === "root" ? state.agentChange : null;
  const stepTitle = (id: string) => {
    const node = draft.definition.nodes.find((item) => item.id === id);
    return node
      ? nodePresentation(
          draft.definition,
          catalog,
          node,
          document.appDisplay,
          false,
        ).title
      : id;
  };
  const update = (next: Draft) => {
    if (!readOnly) state.setDraft(next);
  };
  const focusCanvas = () => {
    root.current?.querySelector<HTMLElement>(".wf-canvas")?.focus();
  };
  const closeSearch = () => {
    setSearch(null);
    setSearchNote(null);
    focusCanvas();
  };
  /** The middle of the canvas, for what a person asks for without pointing. */
  const centre = (): CanvasPoint => {
    const box = root.current
      ?.querySelector(".wf-canvas")
      ?.getBoundingClientRect();
    const client = box
      ? { x: box.left + box.width / 2, y: box.top + box.height / 2 }
      : { x: 0, y: 0 };
    return { client, flow: flow.screenToFlowPosition(client) };
  };
  const refuse = (from: PortRef, to: PortRef, point: CanvasPoint) => {
    const scoped = graphDraft(draft, scope.graphId);
    if (!scoped) return;
    const result = connect(scoped, catalog, from, to);
    if (result.ok) return;
    setSearch(null);
    setPinIssue({
      point,
      message: result.message,
      offers:
        result.reason.kind === "mismatch"
          ? mismatchOffers(scoped, catalog, from, to, point.flow)
          : [],
    });
  };
  const connectPorts = (graphId: string, from: PortRef, to: PortRef) => {
    if (readOnly) return;
    const scoped = graphDraft(draft, graphId);
    if (!scoped) return;
    const result = connect(scoped, catalog, from, to);
    if (result.ok) update(replaceGraphDraft(draft, graphId, result.draft));
    else refuse(from, to, centre());
  };
  const choose = (address: NodeAddress | null) => {
    setAutoRunVersion(null);
    setSelected(address);
    setShowRun(false);
    // A phone shows the step's panel once a step is chosen.
    if (address) setView("panel");
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
  const openSearch = (request: SearchRequest) => {
    if (readOnly) return;
    setPinIssue(null);
    setSearchNote(null);
    setSearch(request);
  };
  const addStep = (entry: StepEntry) => {
    if (readOnly || !search) return;
    const scoped = graphDraft(draft, scope.graphId);
    if (!scoped) return;
    const placed = placeStep(scoped, entry, search.point.flow);
    if (!placed.ok) {
      setSearchNote(placed.message);
      return;
    }
    let next = placed.draft;
    const port = fits?.find((fit) => fit.entry.key === entry.key)?.port;
    if (search.from && port !== undefined) {
      const wired = connect(next, searchCatalog, search.from, {
        node: placed.node.id,
        port,
      });
      if (wired.ok) next = wired.draft;
    }
    update(replaceGraphDraft(draft, scope.graphId, next));
    closeSearch();
    choose({ graphId: scope.graphId, nodeId: placed.node.id });
  };
  const mend = (offer: MismatchOffer) => {
    update(replaceGraphDraft(draft, scope.graphId, offer.draft));
    setPinIssue(null);
    focusCanvas();
  };
  const publish = (runAfterPublish = false) => {
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
          state.confirmPublication(version, draft);
          setAutoRunVersion(runAfterPublish ? version : null);
          // The next step after publishing is running it: show that panel.
          setShowRun(true);
          setView("panel");
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
  const chromeParts: ChromeParts = {
    ...navigation,
    ...editorChrome(
      {
        version: state.version,
        commit: viewedVersion?.commit,
        latestVersion: state.versions.at(0)?.version,
        unchangedPublished,
        durability: document.durability,
        unsaved: state.draft !== state.document?.draft,
        saving: state.saving,
        conflict: state.conflict,
        saveFailed: state.error !== null,
        catalogLoading: state.catalogLoading,
        catalogFailed: state.catalogError !== null,
        problems: issues.length,
        publishing,
        publicationPaused,
        publishFailed: publishError !== null,
        restoring: state.restoring,
        runnable: runVersion !== undefined,
        hasRunPanel: runPanel !== undefined,
        canPublish: store.publish !== undefined,
        canRestore: store.restore !== undefined,
        testable: test.available,
        testStarting: test.phase === "starting",
      },
      {
        run: () => {
          setAutoRunVersion(null);
          setShowRun(true);
          setView("panel");
        },
        restore: () => {
          setConfirmRestore(true);
        },
        testWorkflow: () => {
          setShowRun(false);
          setView("panel");
          test.testWorkflow();
        },
        publish,
      },
    ),
  };
  const notes = [
    state.historyError,
    state.restoreNotice,
    state.restoreError,
    publishError,
    publishedVersion !== null && unchangedPublished && !readOnly,
    confirmRestore,
    runPanel !== undefined && runVersion === undefined,
  ].some(Boolean);
  const searchStatus =
    searchNote ??
    (search?.from && !fits
      ? pinCatalogFailed
        ? "These Apps' steps could not be checked against this pin."
        : "Checking which steps fit…"
      : state.catalogError !== null
        ? "Some Apps' steps are not loaded."
        : undefined);
  return (
    <main className="wf-editor" data-mode="build" data-view={view} ref={root}>
      <CatalogLoadingProvider value={state.catalogLoading}>
        <ChromeSlot active={active} parts={chromeParts} />
        {notes ? (
          <header className="wf-bar" ref={headerRef}>
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
            {state.restoreError && !notify ? (
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
            {publishedVersion !== null &&
            unchangedPublished &&
            !readOnly &&
            !publishError ? (
              <p role="status" className="wf-muted wf-bar-note">
                Published as v{String(publishedVersion)}. Switch it on in
                Triggers.
              </p>
            ) : null}
            {runPanel && runVersion === undefined && !asking ? (
              <p id={runHintId} className="wf-muted wf-bar-note">
                Publish a version to run this workflow.
              </p>
            ) : null}
          </header>
        ) : null}
        <EditorLayout
          view={view}
          onView={setView}
          panelLabel={
            showRun && runPanel
              ? "Run workflow"
              : selected
                ? "Step"
                : "Workflow"
          }
          canvas={
            <>
              <WorkflowCanvas
                key={`${String(state.version ?? "draft")}:${scope.graphId}`}
                readOnly={readOnly}
                graphId={scope.graphId}
                draft={scope.scoped}
                frames={draft.frames}
                onFramesChange={(frames) => {
                  if (!readOnly)
                    state.setDraft((current) =>
                      current ? withFrames(current, frames) : current,
                    );
                }}
                onEnter={inside.enter}
                onExit={() => {
                  inside.enter(scope.parent);
                }}
                crumb={scope.crumb}
                catalog={catalog}
                appDisplay={document.appDisplay}
                issues={issuesOfGraph(issues, scope.graphId)}
                nodeResults={readOnly ? [] : test.steps}
                nodeMarks={shownChange?.diff.marks}
                markedBy={
                  shownChange?.agentId == null
                    ? undefined
                    : agentNames?.[shownChange.agentId]
                }
                ghosts={
                  shownChange
                    ? { draft: shownChange.live, ids: shownChange.diff.removed }
                    : undefined
                }
                readMedia={readMedia}
                selected={selected}
                onSelect={choose}
                onMove={(id, position) => {
                  if (readOnly) return;
                  state.setDraft((current) =>
                    current
                      ? moveStep(current, scope.graphId, id, position)
                      : current,
                  );
                }}
                onConnect={(from, to) => {
                  connectPorts(scope.graphId, from, to);
                }}
                onRemove={(nodeId) => {
                  remove({ graphId: scope.graphId, nodeId });
                }}
                onDisconnect={(index) => {
                  if (readOnly) return;
                  state.setDraft((current) =>
                    current
                      ? disconnectStep(current, scope.graphId, index)
                      : current,
                  );
                }}
                onSearch={(point) => {
                  openSearch({ point });
                }}
                onPinRelease={(from, point) => {
                  openSearch({ point, from });
                }}
                onPinMismatch={refuse}
              />
              {readOnly ? null : (
                <Button
                  className={
                    scope.graphId === "root"
                      ? "wf-add-step"
                      : "wf-add-step wf-add-step-inside"
                  }
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    openSearch({ point: centre() });
                  }}
                >
                  Add a step
                </Button>
              )}
              {!readOnly && draft.definition.nodes.length === 0 ? (
                <p className="wf-empty-hint">Press Tab to add a step</p>
              ) : null}
              {shownChange ? (
                <DraftDiffOverlay
                  diff={shownChange.diff}
                  title={stepTitle}
                  by={
                    shownChange.agentId == null
                      ? undefined
                      : agentNames?.[shownChange.agentId]
                  }
                  busy={state.restoring}
                  onKeep={state.keepAgentChanges}
                  onUndo={
                    shownChange.canUndo
                      ? () => {
                          void state.undoAgentChanges();
                        }
                      : undefined
                  }
                />
              ) : null}
            </>
          }
          panel={
            showRun && runPanel ? (
              <div className="wf-pane-body">
                {runPanel(runVersion, runVersion === autoRunVersion)}
              </div>
            ) : (
              <>
                {testTarget && test.phase !== "idle" ? (
                  <TestRunPanel
                    test={test}
                    client={testTarget.client}
                    definition={draft.definition}
                    catalog={catalog}
                    appDisplay={document.appDisplay}
                    selected={selected}
                    {...(readMedia ? { readMedia } : {})}
                  />
                ) : null}
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
                    appDisplay={
                      state.document?.appDisplay ?? document.appDisplay
                    }
                    selected={selected}
                    issues={issues}
                    onChange={update}
                    onRemove={remove}
                    onConnect={connectPorts}
                  />
                </FieldSet>
              </>
            )
          }
        />
        {search ? (
          <StepSearch
            at={search.point.client}
            entries={entries}
            display={document.appDisplay}
            fits={search.from ? (fits ?? []) : undefined}
            status={searchStatus}
            onChoose={addStep}
            onClose={closeSearch}
          />
        ) : null}
        {pinIssue ? (
          <PinMismatch
            at={pinIssue.point.client}
            message={pinIssue.message}
            offers={pinIssue.offers}
            onOffer={mend}
            onClose={() => {
              setPinIssue(null);
              focusCanvas();
            }}
          />
        ) : null}
        {state.error || state.conflict || state.remoteChange ? (
          <Surface
            role="alert"
            placement="embedded"
            size="sm"
            className="wf-refusal"
          >
            {state.conflict || state.remoteChange
              ? `${state.remoteChange?.by === "agent" ? "An Agent changed this draft" : "This draft changed elsewhere"}. Your edits are still in this window; discard your local edits to open the latest draft.`
              : "Draft could not be saved. Your edits remain in this window."}
            {state.conflict || state.remoteChange ? (
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
