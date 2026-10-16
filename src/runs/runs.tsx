import { formatMoney } from "@fungi.computer/caps/lib/format-money";
import { useCallback, useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@fungi.computer/caps/components/dialog";
import { Badge } from "@fungi.computer/caps/components/badge";
import { Button } from "@fungi.computer/caps/components/button";
import { DataList, DataRow } from "@fungi.computer/caps/components/data-list";
import { Surface } from "@fungi.computer/caps/components/surface";
import { EmptyState } from "@fungi.computer/caps/blocks/empty-state";
import { ReactFlowProvider } from "@xyflow/react";
import type { WorkflowRunListItem } from "@fungi.computer/workflows-wire";
import { versionRelativeTime } from "../history/relative-time.js";
import { WorkflowCanvas } from "../editor/canvas.js";
import { nodePresentation } from "../editor/graph-presentation.js";
import { nodePorts } from "../editor/graph.js";
import type { Draft, DraftCatalog } from "../editor/draft-store.js";
import type { WorkflowClient } from "../workflow-client.js";
import { definitionAppIds } from "../../backend/catalog.js";
import { ReviewCard, type ReadMedia } from "./review-card.js";
import { NodeStatus } from "./node-status.js";
import { StepOutput, OutputPreview, OutputError } from "./output-preview.js";
import { runSteps } from "./run-state.js";
import { runProgress, runNodeState, type RunStatus } from "./run-state.js";
import { useRun } from "./use-run.js";
const noEdit = () => undefined;
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
  onStatus,
  viewerId,
}: {
  client: WorkflowClient;
  item: WorkflowRunListItem;
  readMedia?: ReadMedia;
  onStatus: (run: RunStatus) => void;
  viewerId: string | null;
}) {
  const { run, error, refresh } = useRun(client, item.runId);
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
  function stepTitle(step: (typeof steps)[number]) {
    if (!graph) return graphError ? "Step title unavailable" : "Loading step…";
    const definition = graph.draft.definition;
    const body = step.graphId
      ? new Map(Object.entries(definition.subgraphs ?? {})).get(step.graphId)
      : undefined;
    if (step.graphId && !body) return "Step title unavailable";
    const scope = body ? { ...definition, ...body } : definition;
    const node = scope.nodes.find((candidate) => candidate.id === step.nodeId);
    return node
      ? nodePresentation(scope, graph.catalog, node, graph.appDisplay).title
      : "Step title unavailable";
  }
  return (
    <section
      className="wf-run-detail"
      aria-label="Selected run"
      data-run-id={item.runId}
    >
      <header className="wf-actions">
        <h2>{run?.title ?? item.title ?? "Workflow title unavailable"}</h2>
        <span>
          {run?.outcome === "cancelled"
            ? "Cancelled"
            : (run?.status ?? "Loading…")}
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
            <DialogTrigger render={<Button variant="destructive" />}>
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
      <p className="wf-muted">
        Started by {startedByLabel(item, graph?.draft.definition, viewerId)}
      </p>
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
      {graph ? (
        <div className="wf-run-canvas">
          <ReactFlowProvider>
            <WorkflowCanvas
              readOnly
              draft={graph.draft}
              catalog={graph.catalog}
              appDisplay={graph.appDisplay}
              issues={[]}
              selected={null}
              nodeResults={steps}
              readMedia={readMedia}
              nodeStates={Object.fromEntries(
                graph.draft.definition.nodes.map((node) => [
                  node.id,
                  runNodeState(
                    progress.nodes[node.id] ?? "queued",
                    run?.outcome ?? "active",
                  ),
                ]),
              )}
              onSelect={noEdit}
              onMove={noEdit}
              onConnect={noEdit}
              onRemove={noEdit}
              onDisconnect={noEdit}
              onDrop={noEdit}
            />
          </ReactFlowProvider>
        </div>
      ) : null}
      <DataList density="compact" aria-label="Steps">
        {steps.map((step) => (
          <DataRow
            key={JSON.stringify([
              step.graphId ?? null,
              step.nodeId,
              step.iteration,
            ])}
          >
            <div className="wf-step-result">
              <div className="wf-actions">
                <span className="min-w-0 break-words">
                  {stepTitle(step)}
                  {step.graphId ? ` · ${step.iteration}` : ""}
                </span>
                <NodeStatus state={step.state} />
              </div>
              <StepOutput step={step} readMedia={readMedia} />
            </div>
          </DataRow>
        ))}
      </DataList>
      {progress.durationMs !== null || progress.costMilliunits !== null ? (
        <p className="wf-muted">
          {progress.durationMs !== null
            ? `Recorded step time: ${String(progress.durationMs)} ms`
            : null}
          {progress.durationMs !== null && progress.costMilliunits !== null
            ? " · "
            : null}
          {progress.costMilliunits !== null
            ? `Cost: ${formatMoney(progress.costMilliunits / 100_000)}`
            : null}
        </p>
      ) : null}
      {run?.output !== null && run?.output !== undefined ? (
        <section aria-label="Run output">
          <h3>Run output</h3>
          <OutputPreview value={run.output} readMedia={readMedia} />
        </section>
      ) : null}
      {run?.error !== null && run?.error !== undefined ? (
        <OutputError error={run.error} />
      ) : null}
      {(run?.outcome === "active" ? run.reviews : [])
        .filter((item) => item.status === "pending")
        .map(({ review }) => {
          const definition = graph?.draft.definition;
          const candidates = definition
            ? [
                definition,
                ...Object.values(definition.subgraphs ?? {}).map(
                  (subgraph) => ({
                    ...definition,
                    ...subgraph,
                  }),
                ),
              ].flatMap((scope) =>
                scope.nodes
                  .filter(
                    (node) =>
                      node.kind === "review" && node.id === review.nodeId,
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
            <ReviewCard
              key={`${review.nodeId}:${review.iteration}`}
              runId={item.runId}
              review={review}
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
export function Runs({
  client,
  workflowId,
  selectedRun,
  onSelect,
  readMedia,
}: {
  client: WorkflowClient;
  workflowId?: string;
  selectedRun: string | null;
  onSelect: (id: string) => void;
  readMedia?: ReadMedia;
}) {
  const [states, setStates] = useState<Record<string, string>>({});
  const recordStatus = useCallback((run: RunStatus) => {
    setStates((previous) => ({
      ...previous,
      [run.runId]: run.outcome === "cancelled" ? "Cancelled" : run.status,
    }));
  }, []);
  const [items, setItems] = useState<WorkflowRunListItem[] | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [viewerId, setViewerId] = useState<string | null>(null);
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
  const selected =
    items?.find((item) => item.runId === selectedRun) ?? items?.[0];
  return (
    <main className="wf-runs">
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
            description="Publish a workflow to run it."
          />
        ) : null}
        <DataList density="compact">
          {items?.map((item) => (
            <DataRow key={item.runId} data-run-id={item.runId}>
              <Button
                variant="ghost"
                aria-pressed={selected?.runId === item.runId}
                onClick={() => {
                  onSelect(item.runId);
                }}
                className="wf-run-choice"
              >
                <span className="min-w-0 break-words">
                  {item.title ?? "Workflow title unavailable"}
                  {item.version ? ` · v${String(item.version)}` : ""}
                </span>
                <span className="text-xs">
                  <Badge size="sm" variant="quiet">
                    {sourceLabel[item.source]}
                  </Badge>{" "}
                  {states[item.runId] ? `${states[item.runId]} · ` : ""}
                  <time dateTime={new Date(item.startedAt).toISOString()}>
                    {versionRelativeTime(
                      new Date(item.startedAt).toISOString(),
                    )}
                  </time>
                </span>
              </Button>
            </DataRow>
          ))}
        </DataList>
      </Surface>
      {selected ? (
        <RunDetail
          key={selected.runId}
          client={client}
          item={selected}
          readMedia={readMedia}
          onStatus={recordStatus}
          viewerId={viewerId}
        />
      ) : (
        <EmptyState
          variant="panel"
          title="Choose a run"
          description="Select a run from the list to see its steps and output."
        />
      )}
    </main>
  );
}
