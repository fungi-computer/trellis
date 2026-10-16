import * as z from "zod";
import { runOutcomeSchema } from "@fungi.computer/workflows-wire";
const nodeStateSchema = z.enum([
  "queued",
  "running",
  "waiting",
  "complete",
  "failed",
  "skipped",
]);
const event = z.object({
  nodeId: z.string(),
  graphId: z.string().optional(),
  iteration: z.string(),
  state: nodeStateSchema,
  attempt: z.number(),
  recordedAt: z.number().int().nonnegative().optional(),
  durationMs: z.number().optional(),
  costMilliunits: z.number().optional(),
  output: z.record(z.string(), z.json()).optional(),
  refusal: z.string().optional(),
  errorMessage: z.string().max(1024).optional(),
});
const reviewSchema = z.object({
  nodeId: z.string(),
  iteration: z.string(),
  title: z.string(),
  show: z.array(z.json()),
  choices: z.array(z.string()).optional(),
});
export const runStatusSchema = z.object({
  runId: z.string(),
  planDigest: z.string(),
  outcome: runOutcomeSchema,
  title: z.string(),
  events: z.array(event),
  reviews: z.array(z.object({ review: reviewSchema, status: z.string() })),
  status: z.string(),
  output: z.json(),
  error: z.json(),
});
export type RunStatus = z.output<typeof runStatusSchema>;
export type Review = z.output<typeof reviewSchema>;
export type NodeState = z.output<typeof nodeStateSchema> | "cancelled";
/** Owner cancellation stops unfinished presentation without rewriting recorded events. */
export function runNodeState(
  state: NodeState,
  outcome: RunStatus["outcome"],
): NodeState {
  return outcome === "cancelled" &&
    ["queued", "running", "waiting"].includes(state)
    ? "cancelled"
    : state;
}
export const terminal = (status: string) =>
  ["complete", "errored", "failed", "terminated", "cancelled"].includes(status);
/** Collapse each iteration/attempt to its latest event before summing facts. */
export function runProgress(
  events: RunStatus["events"],
  outcome: RunStatus["outcome"] = "active",
) {
  const latest = new Map<string, RunStatus["events"][number]>();
  const nodes: Record<string, NodeState> = {};
  for (const event of events) {
    latest.set(
      `${event.nodeId}:${event.iteration}:${String(event.attempt)}`,
      event,
    );
    nodes[event.nodeId] = runNodeState(event.state, outcome);
  }
  const recorded = [...latest.values()];
  return {
    nodes,
    durationMs: recorded.some((e) => e.durationMs !== undefined)
      ? recorded.reduce((sum, e) => sum + (e.durationMs ?? 0), 0)
      : null,
    costMilliunits: recorded.some((e) => e.costMilliunits !== undefined)
      ? recorded.reduce((sum, e) => sum + (e.costMilliunits ?? 0), 0)
      : null,
  };
}

/** Latest lifecycle fact per graph node and iteration; each Map item keeps its own result. */
export function runSteps(
  events: RunStatus["events"],
  outcome: RunStatus["outcome"],
  reviews: RunStatus["reviews"] = [],
) {
  const latest = new Map<string, RunStatus["events"][number]>();
  for (const event of events)
    latest.set(
      JSON.stringify([event.graphId ?? null, event.nodeId, event.iteration]),
      event,
    );
  return [...latest.values()].map((event) => {
    const reviewOutput = recordedReviewOutput(event, reviews);
    const state = runNodeState(event.state, outcome);
    if (reviewOutput === undefined) return { ...event, state };
    return { ...event, state, reviewOutput };
  });
}

const reviewOutputSchema = z.object({ choice: z.string(), note: z.string() });
function recordedReviewOutput(
  event: RunStatus["events"][number],
  reviews: RunStatus["reviews"],
) {
  if (event.state !== "complete" || event.output === undefined) return;
  const review = reviews.find(
    ({ review }) =>
      review.nodeId === event.nodeId && review.iteration === event.iteration,
  );
  if (review === undefined) return;
  const answer = reviewOutputSchema.safeParse(event.output);
  if (!answer.success) return;
  const choices = review.review.choices ?? ["approved", "rejected"];
  if (!choices.includes(answer.data.choice)) return;
  const chosenOutput = Object.entries(event.output).find(
    ([port]) => port === answer.data.choice,
  );
  if (chosenOutput === undefined) return;
  return {
    ...answer.data,
    value: chosenOutput[1],
    recordedAt: event.recordedAt,
  };
}

export type RunStep = ReturnType<typeof runSteps>[number];
