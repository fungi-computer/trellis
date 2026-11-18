import { chosenWords } from "./choice-words.js";
import { humanTitle } from "../editor/human-title.js";
import {
  fillReviewText,
  type LoopPosition,
  type Node,
  type WorkflowDefinition,
} from "@fungi.computer/braid";
import {
  stepPosition,
  stepRow,
  type NodeState,
  type RunStep,
} from "./run-state.js";

/** What the timeline needs to know about one installed App. */
export type AppDisplay = Readonly<
  Partial<Record<string, Readonly<{ displayName: string; icon?: string }>>>
>;

/** One thing that happened in a run, in words a person reads. */
export type TimelineItem = Readonly<{
  key: string;
  state: NodeState;
  title: string;
  detail?: string | undefined;
  /** The installed App that did it, when an App did. */
  app?: Readonly<{ appId: string; displayName: string; icon?: string }>;
  durationMs?: number | undefined;
  media?: Readonly<{ path: string; format: "fungi:image" | "fungi:video" }>;
  /** Where "Open in <App>" goes. */
  open?: Readonly<{
    appId: string;
    params: readonly Readonly<{ key: string; value: string }>[];
  }>;
  /** The label of the choice made, for a review the person has answered. */
  chose?: string;
  /** The recorded step, for the raw ▸ view. */
  step: RunStep;
}>;

function scopeOf(definition: WorkflowDefinition, step: RunStep) {
  if (step.graphId === undefined) return definition;
  const body = new Map(Object.entries(definition.subgraphs ?? {})).get(
    step.graphId,
  );
  return body ? { ...definition, ...body } : undefined;
}

/** "18s", "4m", "6m 12s": the same short durations the tool timeline uses. */
export function formatDuration(ms: number) {
  const seconds = Math.round(ms / 1000);
  if (seconds < 1) return "under 1s";
  if (seconds < 60) return `${String(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  if (minutes < 60)
    return rest === 0
      ? `${String(minutes)}m`
      : `${String(minutes)}m ${String(rest)}s`;
  const hours = Math.floor(minutes / 60);
  return `${String(hours)}h ${String(minutes % 60)}m`;
}

/** "item 2 · try 3": which Map item and Repeat try a step ran in, when it ran in one. */
function placeWords(position: LoopPosition) {
  return position.flatMap((place) =>
    place.loop === "map"
      ? [`item ${String(place.index + 1)}`]
      : place.count > 1
        ? [`try ${String(place.index + 1)}`]
        : [],
  );
}

/** Join the parts of a muted detail line, leaving out the missing ones. */
function detailLine(...parts: readonly (string | undefined)[]) {
  const present = parts.filter(
    (part): part is string => part !== undefined && part.length > 0,
  );
  return present.length > 0 ? present.join(" · ") : undefined;
}

function decision(node: Extract<Node, { kind: "review" }>, step: RunStep) {
  const output = "reviewOutput" in step ? step.reviewOutput : undefined;
  if (output === undefined) return { title: "You answered the review" };
  const choice = node.choices?.find((item) => item.id === output.choice);
  const label =
    choice?.label ??
    (output.choice === "approved"
      ? "Approve"
      : output.choice === "rejected"
        ? "Reject"
        : output.choice);
  const note = output.note.length > 0 ? `“${output.note}”` : undefined;
  const consequence =
    choice?.description === undefined
      ? undefined
      : fillReviewText(choice.description, stepPosition(step));
  return {
    title: chosenWords(output.choice, label),
    detail: detailLine(consequence, note),
    chose: label,
  };
}

/**
 * Turn recorded steps into what a person reads: each App step says what the
 * App did (its own row when it declared one), each answered review says what
 * you chose, and every other step that ran says so by its own name. Steps that
 * never ran stay out.
 */
export function timelineItems(
  steps: readonly RunStep[],
  definition: WorkflowDefinition,
  appDisplay: AppDisplay,
): TimelineItem[] {
  const items: TimelineItem[] = [];
  for (const step of steps) {
    if (step.state === "queued" || step.state === "skipped") continue;
    const scope = scopeOf(definition, step);
    const node = scope?.nodes.find((candidate) => candidate.id === step.nodeId);
    if (node === undefined) continue;
    const key = JSON.stringify([
      step.graphId ?? null,
      step.nodeId,
      step.iteration,
    ]);
    const base = { key, state: step.state, durationMs: step.durationMs, step };
    if (node.kind === "review") {
      // A waiting review is the docked question, not a timeline entry.
      if (step.state === "complete")
        items.push({ ...base, ...decision(node, step) });
      continue;
    }
    if (node.kind !== "app") {
      // A step that is not an App still happened: say so in the step's own name.
      const name = node.title ?? humanTitle(node.id);
      if (step.state === "failed")
        items.push({
          ...base,
          title: name,
          detail: step.errorMessage ?? step.refusal,
        });
      else if (step.state === "complete")
        items.push({
          ...base,
          title: name,
          detail: detailLine(...placeWords(stepPosition(step))),
        });
      else if (step.state === "running")
        items.push({ ...base, title: `${name} is running` });
      continue;
    }
    const appId = new Map(Object.entries(definition.apps)).get(node.app)?.appId;
    const display = appId === undefined ? undefined : appDisplay[appId];
    const name = display?.displayName ?? node.app;
    // The step is named as the canvas names it, never by its method id.
    const stepName = node.title ?? humanTitle(node.method);
    const app =
      appId === undefined
        ? undefined
        : display?.icon === undefined
          ? { appId, displayName: name }
          : { appId, displayName: name, icon: display.icon };
    const withApp = app === undefined ? base : { ...base, app };
    if (step.state === "failed") {
      items.push({
        ...withApp,
        title: stepName,
        detail: step.errorMessage ?? step.refusal,
      });
      continue;
    }
    if (step.state !== "complete") {
      items.push({ ...withApp, title: `${stepName} is running` });
      continue;
    }
    const row = stepRow(step);
    if (row === undefined) {
      items.push({ ...withApp, title: stepName });
      continue;
    }
    let item: TimelineItem = {
      ...withApp,
      title: row.title,
      detail: detailLine(...placeWords(stepPosition(step)), row.detail),
    };
    if (row.media !== undefined) item = { ...item, media: row.media };
    if (row.open !== undefined && appId !== undefined)
      item = { ...item, open: { appId, params: row.open.params } };
    items.push(item);
  }
  return items;
}

/** Facts for the closing line of a finished run. */
export function runFinish(
  steps: readonly RunStep[],
  items: readonly TimelineItem[],
  costMilliunits: number | null,
) {
  const times = steps.flatMap((step) =>
    step.recordedAt === undefined ? [] : [step.recordedAt],
  );
  const elapsed =
    times.length > 1 ? Math.max(...times) - Math.min(...times) : undefined;
  const apps = new Set(
    items.flatMap((item) => (item.app ? [item.app.appId] : [])),
  );
  return {
    elapsed,
    apps: apps.size,
    // Only a recorded, non-zero cost is worth a line.
    cost: costMilliunits !== null && costMilliunits > 0 ? costMilliunits : null,
  };
}

/**
 * Where each step of the run's own graph stands, for the canvas and the phone
 * strip. A step with no record yet is "not yet" while the run is going and
 * "not reached" once it is over.
 */
export function runNodeStates(
  steps: readonly RunStep[],
  definition: WorkflowDefinition,
  finished: boolean,
): Record<string, NodeState> {
  const latest = new Map<string, NodeState>();
  for (const step of steps)
    if (step.graphId === undefined) latest.set(step.nodeId, step.state);
  return Object.fromEntries(
    definition.nodes.map((node) => [
      node.id,
      latest.get(node.id) ?? (finished ? "skipped" : "queued"),
    ]),
  );
}

/**
 * What the canvas is given for a run on show: every recorded step, and a record
 * of "not yet" or "not reached" for each step the run has no record of, so the
 * canvas words them as this run's and not as a draft's last run.
 */
export function runCanvasSteps(
  steps: readonly RunStep[],
  states: Readonly<Record<string, NodeState>>,
): RunStep[] {
  const recorded = new Set(
    steps.flatMap((step) => (step.graphId === undefined ? [step.nodeId] : [])),
  );
  return [
    ...steps,
    ...Object.entries(states).flatMap(([nodeId, state]) =>
      recorded.has(nodeId)
        ? []
        : [{ nodeId, iteration: "0", attempt: 0, state }],
    ),
  ];
}
