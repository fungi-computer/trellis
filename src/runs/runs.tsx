import { formatMoney } from "@fungi.computer/caps/lib/format-money";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@fungi.computer/caps/components/dialog";
import { ActionRow } from "@fungi.computer/caps/components/action-row";
import { Button } from "@fungi.computer/caps/components/button";
import {
  DataList,
  DataListHeading,
  DataRow,
} from "@fungi.computer/caps/components/data-list";
import { Surface } from "@fungi.computer/caps/components/surface";
import { EmptyState } from "@fungi.computer/caps/blocks/empty-state";
import type { WorkflowRunListItem } from "@fungi.computer/workflows-wire";
import { versionRelativeTime } from "../history/relative-time.js";
import { nodePorts } from "../editor/graph.js";
import type { Draft, DraftCatalog } from "../editor/draft-store.js";
import type { WorkflowClient } from "../workflow-client.js";
import { definitionAppIds } from "../../backend/catalog.js";
import { useChrome } from "../chrome.js";
import { ReviewDock, type ReadMedia } from "./review-dock.js";
import { NodeStatus } from "./node-status.js";
import { OutputError } from "./output-preview.js";
import {
  runBeadState,
  runLatestLine,
  runProgress,
  runSection,
  runSteps,
  type RunStatus,
} from "./run-state.js";
import { RunTimeline, type OpenInApp } from "./run-timeline.js";
import { formatDuration, runFinish, timelineItems } from "./timeline-items.js";
import { useRun } from "./use-run.js";
import { useRunSummaries } from "./use-run-summaries.js";
export type { OpenInApp } from "./run-timeline.js";
const sourceLabel = {
  manual: "Manual",
  schedule: "Schedule",
  event: "Event",
  agent: "Agent",
  key: "Key",
} satisfies Record<WorkflowRunListItem["source"], string>;
/**
 * The trigger's own label, or the source's generic name while it loads.
 * An owner now sees every run in the installation, so a manual run's
 * "Started by" must name who actually ran it: "You" for the viewer's own
 * run, the other member's id otherwise. `viewerId` is null until the
 * viewer's own identity loads, so nothing is misreported as "You" early.
 */
function startedByLabel(
  item: WorkflowRunListItem,
  definition:
    | { triggers?: readonly { id: string; on: string; event?: string }[] }
    | undefined,
  viewerId: string | null,
): string {
  if (item.source === "manual") {
    if (item.initiatedBy.kind !== "member") return "Unknown";
    return item.initiatedBy.memberId === viewerId
      ? "You"
      : item.initiatedBy.memberId;
  }
  if (item.source === "agent")
    return item.initiatedBy.kind === "agent"
      ? `Agent ${item.initiatedBy.agentId} with ${item.initiatedBy.grantorMemberId}'s access`
      : "Agent";
  if (item.source === "key")
    return item.initiatedBy.kind === "key"
      ? `Key ${item.initiatedBy.keyId} with ${item.initiatedBy.grantorMemberId}'s access`
      : "Key";
  const trigger = definition?.triggers?.find((t) => t.id === item.triggerId);
  if (!trigger) return sourceLabel[item.source];
  if (trigger.on === "schedule") return "schedule";
  if (trigger.on === "event" && trigger.event !== undefined)
    return trigger.event;
  return trigger.on;
}
function RunDetail({
  client,
  item,
  readMedia,
  openIn,
  onStatus,
  viewerId,
}: {
  client: WorkflowClient;
  item: WorkflowRunListItem;
  readMedia?: ReadMedia;
  openIn?: OpenInApp;
  onStatus: (run: RunStatus) => void;
  viewerId: string | null;
}) {
  const { run: loaded, error, refresh } = useRun(client, item.runId);
  const run = loaded ?? undefined;
  useEffect(() => {
    if (run) onStatus(run);
  }, [run, onStatus]);
  const [graph, setGraph] = useState<
    (Pick<DraftCatalog, "catalog" | "appDisplay"> & { draft: Draft }) | null
  >(null);
  const [graphError, setGraphError] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState(false);
  useEffect(() => {
    let active = true;
    setGraph(null);
    setGraphError(false);
    void client
      .loadWorkflow(item.workflowId, { commit: item.commit })
      .then(async (draft) => {
        if (!draft) {
          if (active) setGraphError(true);
          return;
        }
        const { catalog, apps } = await client.catalog(
          definitionAppIds(draft.definition),
        );
        if (!active) return;
        setGraph({
          draft,
          catalog,
          appDisplay: Object.fromEntries(
            apps.map(({ appId, displayName, icon }) => [
              appId,
              icon === undefined ? { displayName } : { displayName, icon },
            ]),
          ),
        });
      })
      .catch((cause: unknown) => {
        void cause;
        if (active) setGraphError(true);
      });
    return () => {
      active = false;
    };
  }, [client, item.workflowId, item.commit]);
  async function cancel() {
    setCancelling(true);
    setCancelError(false);
    try {
      const result = await client.cancel(item.runId);
      if ("error" in result || result.kind === "refused") setCancelError(true);
      else {
        setConfirming(false);
        refresh();
      }
    } catch {
      setCancelError(true);
    } finally {
      setCancelling(false);
    }
  }
  const progress = runProgress(run?.events ?? [], run?.outcome ?? "active");
  const steps = runSteps(
    run?.events ?? [],
    run?.outcome ?? "active",
    run?.reviews ?? [],
  );
  const items = graph
    ? timelineItems(steps, graph.draft.definition, graph.appDisplay)
    : [];
  const pending = (run?.outcome === "active" ? run.reviews : []).filter(
    (review) => review.status === "pending",
  );
  const finished = run !== undefined && runSection(run) === "finished";
  const finish = runFinish(steps, items, progress.costMilliunits);
  const scroller = useRef<HTMLDivElement>(null);
  const newest = `${String(items.length)}:${String(pending.length)}`;
  useEffect(() => {
    const element = scroller.current;
    if (element && newest !== "") element.scrollTop = element.scrollHeight;
  }, [newest]);
  return (
    <section
      className="wf-run-detail"
      aria-label="Selected run"
      data-run-id={item.runId}
    >
      <header className="wf-actions">
        <h2>{run?.title ?? item.title ?? "Workflow title unavailable"}</h2>
        <span className="wf-muted">
          Started by {startedByLabel(item, graph?.draft.definition, viewerId)} ·{" "}
          <time dateTime={new Date(item.startedAt).toISOString()}>
            {versionRelativeTime(new Date(item.startedAt).toISOString())}
          </time>
        </span>
        {run?.outcome === "active" ? (
          <Dialog
            open={confirming}
            onOpenChange={(next, details) => {
              if (cancelling) {
                details.cancel();
                return;
              }
              setConfirming(next);
            }}
          >
            <DialogTrigger render={<Button variant="ghost" size="sm" />}>
              Cancel run
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Cancel this run?</DialogTitle>
                <DialogDescription>
                  Cancellation cannot be undone. Completed work is kept;
                  unfinished steps stop.
                </DialogDescription>
              </DialogHeader>
              {cancelError ? (
                <p role="alert">Run could not be cancelled. Try again.</p>
              ) : null}
              <DialogFooter>
                <Button
                  variant="ghost"
                  disabled={cancelling}
                  onClick={() => {
                    setConfirming(false);
                  }}
                >
                  Keep running
                </Button>
                <Button
                  variant="destructive"
                  disabled={cancelling}
                  onClick={() => void cancel()}
                >
                  {cancelling ? "Cancelling…" : "Confirm cancellation"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        ) : null}
      </header>
      {error ? (
        <p role="alert">
          Run could not be loaded.{" "}
          <Button variant="ghost" onClick={refresh}>
            Retry
          </Button>
        </p>
      ) : null}
      {graphError ? (
        <p role="alert">
          The published graph or App catalog could not be loaded.
        </p>
      ) : null}
      <div className="wf-run-timeline" ref={scroller}>
        {!graph && !graphError ? (
          <p className="wf-muted">Loading steps…</p>
        ) : null}
        <RunTimeline items={items} readMedia={readMedia} openIn={openIn} />
        {run?.error !== null && run?.error !== undefined ? (
          <OutputError error={run.error} />
        ) : null}
        {finished ? (
          <p className="wf-finish">
            <NodeStatus
              state={runBeadState(run)}
              bare
              label={run.outcome === "cancelled" ? "cancelled" : run.status}
            />
            <span>
              {run.outcome === "cancelled"
                ? "Cancelled"
                : runBeadState(run) === "failed"
                  ? "Failed"
                  : `Done${finish.elapsed === undefined ? "" : ` in ${formatDuration(finish.elapsed)}`}`}
              {finish.apps > 0
                ? ` · ${String(finish.apps)} ${finish.apps === 1 ? "App" : "Apps"}`
                : ""}
              {finish.cost === null
                ? ""
                : ` · ${formatMoney(finish.cost / 100_000)}`}
            </span>
          </p>
        ) : null}
      </div>
      {pending.map(({ review }) => {
        const definition = graph?.draft.definition;
        const candidates = definition
          ? [
              definition,
              ...Object.values(definition.subgraphs ?? {}).map((subgraph) => ({
                ...definition,
                ...subgraph,
              })),
            ].flatMap((scope) =>
              scope.nodes
                .filter(
                  (node) => node.kind === "review" && node.id === review.nodeId,
                )
                .map((node) => ({ scope, node })),
            )
          : [];
        // Run reviews identify a node and iteration; repeated ids cannot identify a graph.
        const resolved = candidates.length === 1 ? candidates[0] : undefined;
        const node = resolved?.node;
        const ref = node?.kind === "review" ? node.show[0] : undefined;
        const format =
          ref && graph && resolved
            ? Object.entries(
                nodePorts(resolved.scope, graph.catalog, ref.node).outputs,
              ).find(([port]) => port === ref.port)?.[1].format
            : undefined;
        return (
          <ReviewDock
            key={`${review.nodeId}:${review.iteration}`}
            runId={item.runId}
            review={review}
            detail={node?.kind === "review" ? node.detail : undefined}
            choices={node?.kind === "review" ? node.choices : undefined}
            format={format}
            readMedia={readMedia}
            answerReview={client.answerReview}
            onAnswered={refresh}
          />
        );
      })}
    </section>
  );
}

const sectionTitles = {
  "needs-you": "Needs you",
  running: "Running",
  finished: "Finished",
} as const;

/** True at phone width, where the list and a run are separate pages. */
function useCompact() {
  const query = "(max-width: 720px)";
  const [compact, setCompact] = useState(
    () => window.matchMedia(query).matches,
  );
  useEffect(() => {
    const list = window.matchMedia(query);
    const change = () => {
      setCompact(list.matches);
    };
    list.addEventListener("change", change);
    return () => {
      list.removeEventListener("change", change);
    };
  }, []);
  return compact;
}

export function Runs({
  client,
  workflowId,
  selectedRun,
  onSelect,
  readMedia,
  openIn,
}: {
  client: WorkflowClient;
  workflowId?: string;
  selectedRun: string | null;
  onSelect: (id: string) => void;
  readMedia?: ReadMedia;
  openIn?: OpenInApp;
}) {
  const [items, setItems] = useState<WorkflowRunListItem[] | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [viewerId, setViewerId] = useState<string | null>(null);
  const compact = useCompact();
  const { runs, record, readErrors } = useRunSummaries(client, items);
  const recordStatus = useCallback(
    (run: RunStatus) => {
      record(run);
    },
    [record],
  );
  useEffect(() => {
    let active = true;
    // Optional, like chatChoices: a failed read only means "Started by"
    // shows an id instead of "You" a little longer, never a page failure.
    void client.viewerId().then(
      (reply) => {
        if (active && "memberId" in reply) setViewerId(reply.memberId);
      },
      () => undefined,
    );
    return () => {
      active = false;
    };
  }, [client]);
  useEffect(() => {
    let active = true;
    setItems(null);
    setError(false);
    void client.listRuns(workflowId).then(
      (rows) => {
        if (active) setItems(rows);
      },
      () => {
        if (active) setError(true);
      },
    );
    return () => {
      active = false;
    };
  }, [client, workflowId, selectedRun, attempt]);
  const chosen = items?.find((item) => item.runId === selectedRun);
  // A person's own pick wins; otherwise the first run waiting on them, then the newest.
  const preferred =
    items?.find((item) => runSection(runs[item.runId]) === "needs-you") ??
    items?.[0];
  const selected = chosen ?? (compact ? undefined : preferred);
  useChrome("runs", {
    crumbs: selected
      ? [
          {
            id: "run",
            label: `Run · ${versionRelativeTime(new Date(selected.startedAt).toISOString())}`,
          },
        ]
      : [],
  });
  const showList = !compact || selected === undefined;
  const showDetail = !compact || selected !== undefined;
  return (
    <main className="wf-runs" data-compact={compact ? "" : undefined}>
      {showList ? (
        <Surface placement="embedded" size="sm" className="wf-run-list">
          {error ? (
            <p role="alert">
              Runs could not be loaded.{" "}
              <Button
                variant="ghost"
                onClick={() => {
                  setAttempt((value) => value + 1);
                }}
              >
                Retry
              </Button>
            </p>
          ) : null}
          {!items && !error ? <p>Loading runs…</p> : null}
          {items?.length === 0 ? (
            <EmptyState
              headingLevel={3}
              variant="quiet"
              title="No runs yet"
              description="Runs from every workflow appear here."
            />
          ) : null}
          {(["needs-you", "running", "finished"] as const).map((section) => {
            const rows = (items ?? []).filter(
              (item) => runSection(runs[item.runId]) === section,
            );
            return rows.length === 0 ? null : (
              <section key={section} aria-label={sectionTitles[section]}>
                <DataListHeading level={3}>
                  {sectionTitles[section]}
                </DataListHeading>
                <DataList density="compact">
                  {rows.map((item) => {
                    const when = new Date(item.startedAt).toISOString();
                    const line =
                      runLatestLine(runs[item.runId]) ??
                      readErrors.get(item.runId)?.message ??
                      sourceLabel[item.source];
                    return (
                      <DataRow key={item.runId} data-run-id={item.runId}>
                        <ActionRow
                          appearance="plain"
                          density="compact"
                          variant="ghost"
                          className={
                            selected?.runId === item.runId
                              ? "wf-run-choice bg-base-300"
                              : "wf-run-choice"
                          }
                          aria-current={
                            selected?.runId === item.runId ? "page" : undefined
                          }
                          onClick={() => {
                            onSelect(item.runId);
                          }}
                          label={`${item.title ?? "Workflow title unavailable"}${item.version ? ` · v${String(item.version)}` : ""}`}
                          description={
                            item.source === "manual"
                              ? line
                              : `${sourceLabel[item.source]} · ${line}`
                          }
                          trailing={
                            <span className="inline-flex items-center gap-1.5">
                              <NodeStatus
                                state={runBeadState(runs[item.runId])}
                                bare
                              />
                              <time dateTime={when}>
                                {versionRelativeTime(when)}
                              </time>
                            </span>
                          }
                        />
                      </DataRow>
                    );
                  })}
                </DataList>
              </section>
            );
          })}
        </Surface>
      ) : null}
      {showDetail && selected ? (
        <RunDetail
          key={selected.runId}
          client={client}
          item={selected}
          readMedia={readMedia}
          openIn={openIn}
          onStatus={recordStatus}
          viewerId={viewerId}
        />
      ) : showDetail ? (
        <EmptyState
          variant="panel"
          title="Choose a run"
          description="Select a run from the list to see what happened."
        />
      ) : null}
    </main>
  );
}
