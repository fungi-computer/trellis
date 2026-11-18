import { useState } from "react";
import * as z from "zod";
import { Button } from "@fungi.computer/caps/components/button";
import { FailureLine } from "@fungi.computer/caps/components/failure-line";
import type {
  Catalog,
  Json,
  Mapping,
  Node,
  WorkflowDefinition,
} from "@fungi.computer/braid";
import { ReviewDock } from "../runs/review-dock.js";
import { NodeStatus } from "../runs/node-status.js";
import { StepOutput, type ReadMedia } from "../runs/output-preview.js";
import type { RunStep } from "../runs/run-state.js";
import { nodeResultsFor } from "./graph-results.js";
import { nodePorts } from "./graph.js";
import type { DraftDocument } from "./draft-store.js";
import { inputTitle, nodePresentation } from "./graph-presentation.js";
import type { NodeAddress } from "./graph-address.js";
import type { TestRun } from "./use-test-run.js";
import type { WorkflowClient } from "../workflow-client.js";

/** What a step is called on screen: its own title, else the card's words. */
function stepName(
  definition: WorkflowDefinition,
  catalog: Catalog,
  appDisplay: DraftDocument["appDisplay"],
  id: string,
) {
  const node = definition.nodes.find((candidate) => candidate.id === id);
  return node === undefined
    ? id
    : nodePresentation(definition, catalog, node, appDisplay).title;
}

/** "Testing the whole workflow" or "Testing Make the cover and the 2 steps before it". */
export function testLine(
  definition: WorkflowDefinition,
  catalog: Catalog,
  appDisplay: DraftDocument["appDisplay"],
  test: Pick<TestRun, "step" | "before">,
) {
  if (test.step === undefined) return "Testing the whole workflow";
  const name = stepName(definition, catalog, appDisplay, test.step);
  if (test.before === 0) return `Testing ${name}`;
  return `Testing ${name} and the ${String(test.before)} ${test.before === 1 ? "step" : "steps"} before it`;
}

/** A value as a person reads it: text as it is, anything else as JSON. */
function plain(value: Json) {
  const text = z.string().safeParse(value);
  return text.success ? text.data : JSON.stringify(value);
}

/** Where a wire's value was recorded in this test, else where it comes from. */
function wired(
  from: Readonly<{ node: string; port: string }>,
  results: readonly RunStep[],
) {
  const recorded = nodeResultsFor(results, from.node, undefined).at(-1)
    ?.output?.[from.port];
  const source = from.node === "$input" ? inputTitle : from.node;
  return recorded ?? `from ${source} · ${from.port}`;
}

/**
 * What a step was given in this test: its fixed fields, and the values wired
 * into its pins as its earlier steps recorded them.
 */
function resolvedInputs(
  definition: WorkflowDefinition,
  node: Node,
  results: readonly RunStep[],
) {
  const values: Readonly<Record<string, Mapping>> =
    "values" in node ? node.values : "fields" in node ? node.fields : {};
  const fields = Object.entries(values).map(([name, mapping]) => {
    if ("literal" in mapping) return [name, mapping.literal] as const;
    if ("template" in mapping) return [name, mapping.template] as const;
    if ("from" in mapping) return [name, wired(mapping.from, results)] as const;
    return [name, "(computed)"] as const;
  });
  const pins = definition.edges
    .filter((edge) => edge.to.node === node.id)
    .map((edge) => [edge.to.port, wired(edge.from, results)] as const);
  return Object.fromEntries([...pins, ...fields]);
}

/** The selected step's input and output in this test, with the raw JSON a click away. */
function InputOutput({
  definition,
  catalog,
  results,
  selected,
  readMedia,
}: {
  definition: WorkflowDefinition;
  catalog: Catalog;
  results: readonly RunStep[];
  selected: NodeAddress;
  readMedia: ReadMedia | undefined;
}) {
  const [json, setJson] = useState(false);
  const node =
    selected.graphId === "root"
      ? definition.nodes.find((candidate) => candidate.id === selected.nodeId)
      : undefined;
  if (node === undefined) return null;
  const own = nodeResultsFor(results, node.id, undefined);
  const step = own.at(-1);
  const formats = Object.fromEntries(
    Object.entries(nodePorts(definition, catalog, node.id).outputs).map(
      ([port, schema]) => [port, schema.format],
    ),
  );
  if (step === undefined)
    return <p className="wf-muted">This step has not run in this test.</p>;
  const input = resolvedInputs(definition, node, results);
  return (
    <section className="wf-test-io" aria-label="Input and output">
      <h3>Input</h3>
      <dl>
        {Object.entries(input).map(([name, value]) => (
          <div key={name}>
            <dt>{name}</dt>
            <dd>{plain(value)}</dd>
          </div>
        ))}
      </dl>
      <h3>Output</h3>
      <StepOutput step={step} formats={formats} readMedia={readMedia} />
      <Button
        variant="ghost"
        size="sm"
        aria-pressed={json}
        onClick={() => {
          setJson((value) => !value);
        }}
      >
        Show as JSON
      </Button>
      {json ? (
        <pre className="wf-test-json">
          {JSON.stringify({ input, output: step.output ?? null }, null, 2)}
        </pre>
      ) : null}
    </section>
  );
}

/**
 * The test, in the editor's right panel: what is being tested, the write steps
 * that need a yes, any review the test stops at (the same dock a live run
 * shows), and the selected step's input and output. A test never says who or
 * what started it: nothing triggered it.
 */
export function TestRunPanel({
  test,
  client,
  definition,
  catalog,
  appDisplay,
  selected,
  readMedia,
}: {
  test: TestRun;
  client: WorkflowClient;
  definition: WorkflowDefinition;
  catalog: Catalog;
  appDisplay: DraftDocument["appDisplay"];
  selected: NodeAddress | null;
  readMedia?: ReadMedia;
}) {
  const run = test.run;
  const pending = (run?.outcome === "active" ? run.reviews : []).filter(
    (review) => review.status === "pending",
  );
  const finished = run !== null && run.outcome !== "active";
  return (
    <section className="wf-test" aria-label="Test">
      {test.phase === "starting" ? (
        <p role="status" className="wf-test-line">
          Starting the test…
        </p>
      ) : null}
      {test.phase === "notice" ? (
        <div role="alert" className="wf-test-notice">
          <p>{test.message}</p>
          <Button variant="ghost" size="sm" onClick={test.dismiss}>
            Close
          </Button>
        </div>
      ) : null}
      {test.phase === "confirm" ? (
        <div
          role="alertdialog"
          aria-label="Run write steps"
          className="wf-test-confirm"
        >
          <p>
            {test.writes.length === 1
              ? "This step really writes or posts:"
              : `These ${String(test.writes.length)} steps really write or post:`}
          </p>
          <ul>
            {test.writes.map((write) => (
              <li key={`${write.graph}:${write.node}`}>
                {stepName(definition, catalog, appDisplay, write.node)} ·{" "}
                {appDisplay[write.appId]?.displayName ?? write.appId} ·{" "}
                {write.method}
                {write.effect === "external" ? " (reaches outside)" : ""}
              </li>
            ))}
          </ul>
          <Button size="sm" onClick={test.confirmWrites}>
            Run them for real
          </Button>
          <Button variant="ghost" size="sm" onClick={test.dismiss}>
            Don't run
          </Button>
        </div>
      ) : null}
      {test.phase === "running" ? (
        <>
          <p className="wf-test-line" role="status">
            {run === null ? null : (
              <NodeStatus
                state={
                  finished
                    ? run.outcome === "cancelled"
                      ? "cancelled"
                      : run.status === "complete"
                        ? "complete"
                        : "failed"
                    : "running"
                }
                bare
                label={run.status}
              />
            )}{" "}
            {testLine(definition, catalog, appDisplay, test)}
            {finished
              ? ` · ${run.status === "complete" ? "done" : run.status}`
              : ""}
          </p>
          {test.readFailed ? (
            <FailureLine
              message="The test could not be read."
              onRetry={test.refresh}
            />
          ) : null}
          {pending.map(({ review }) => {
            const node = definition.nodes.find(
              (candidate) =>
                candidate.kind === "review" && candidate.id === review.nodeId,
            );
            const ref = node?.kind === "review" ? node.show[0] : undefined;
            const format =
              ref === undefined
                ? undefined
                : Object.entries(
                    nodePorts(definition, catalog, ref.node).outputs,
                  ).find(([port]) => port === ref.port)?.[1].format;
            return (
              <ReviewDock
                key={`${review.nodeId}:${review.iteration}`}
                runId={run?.runId ?? ""}
                review={review}
                detail={node?.kind === "review" ? node.detail : undefined}
                choices={node?.kind === "review" ? node.choices : undefined}
                format={format}
                readMedia={readMedia}
                answerReview={client.answerReview}
                onAnswered={test.refresh}
              />
            );
          })}
          {selected ? (
            <InputOutput
              definition={definition}
              catalog={catalog}
              results={test.steps}
              selected={selected}
              readMedia={readMedia}
            />
          ) : (
            <p className="wf-muted">
              Select a step to see what it got and made.
            </p>
          )}
          <Button variant="ghost" size="sm" onClick={test.dismiss}>
            Close test
          </Button>
        </>
      ) : null}
    </section>
  );
}
