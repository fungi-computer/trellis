import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as z from "zod";
import {
  parseProjection,
  type WorkflowDefinition,
} from "@fungi.computer/braid";
import {
  testDraftReply,
  workflowRunRequestIds,
} from "@fungi.computer/workflows-wire";
import { testScope } from "../../backend/test-scope.js";
import { workflowInputField } from "../runs/input-form.js";
import { runSteps } from "../runs/run-state.js";
import { useRun } from "../runs/use-run.js";
import type { WorkflowClient } from "../workflow-client.js";

/** Where a test runs: the Workflow's client and the draft being edited. */
export type TestTarget = Readonly<{
  client: WorkflowClient;
  workflowId: string;
}>;

/** A step in the test that really writes or posts, from the backend's own list. */
type TestWriteStep = Extract<
  z.output<typeof testDraftReply>,
  { kind: "writes_need_confirmation" }
>["steps"][number];

/** What a test is doing; the run itself is read through `useRun`. */
type TestPhase =
  | Readonly<{ kind: "idle" }>
  | Readonly<{ kind: "starting"; step: string | undefined }>
  | Readonly<{
      kind: "confirm";
      step: string | undefined;
      writes: readonly TestWriteStep[];
    }>
  | Readonly<{ kind: "notice"; message: string }>
  | Readonly<{
      kind: "running";
      runId: string;
      step: string | undefined;
      /** The root steps this test runs, in the draft's order. */
      scope: readonly string[];
      before: number;
    }>;

const idle: TestPhase = { kind: "idle" };

/** Words for a refusal the backend names; anything else says it could not start. */
function refusal(reply: Readonly<{ error: string }>) {
  if (reply.error === "not_found") return "This draft no longer exists.";
  if (reply.error === "unknown_step")
    return "That step is not in the saved draft. Save it and try again.";
  if (reply.error === "not_granted")
    return "This host will not run this test: a step in it needs an approval the host cannot give here.";
  return `The test could not start (${reply.error}). Try again.`;
}

/**
 * Tests the saved draft through `testDraft` and follows the run. One window
 * has one test at a time: starting another replaces it. `testStep` is the
 * entry the step panel's "Test step" button calls.
 */
export function useTestRun({
  target,
  definition,
  revision,
}: {
  /** Absent where the host cannot run tests (a read-only or embedded editor). */
  target: TestTarget | undefined;
  /** The draft on screen; the test runs the saved copy of it. */
  definition: WorkflowDefinition | undefined;
  /** The saved revision of that draft; unknown until it has loaded. */
  revision: number | undefined;
}) {
  const [phase, setPhase] = useState<TestPhase>(idle);
  const setNotice = useCallback((message: string) => {
    setPhase({ kind: "notice", message });
  }, []);
  const identity = useRef<{ key: string; id: string } | null>(null);
  const attempt = useRef(0);
  useEffect(() => {
    attempt.current += 1;
    setPhase(idle);
  }, [target?.client, target?.workflowId]);
  const runId = phase.kind === "running" ? phase.runId : null;
  const { run, error, refresh } = useRun(target?.client, runId);
  const steps = useMemo(
    () => (run === null ? [] : runSteps(run.events, run.outcome, run.reviews)),
    [run],
  );
  const start = useCallback(
    async (step: string | undefined, allowWrites: boolean) => {
      if (target === undefined || definition === undefined) return;
      if (revision === undefined) return;
      const mine = ++attempt.current;
      const scope = testScope(definition, step);
      if (scope === null) {
        setNotice("That step is not in this draft.");
        return;
      }
      // A test starts with the Run form's own defaults, never invented values.
      const field = workflowInputField(parseProjection(definition.input));
      const input = field.schema.safeParse(field.defaultValue);
      if (!input.success) {
        setNotice(
          `This workflow needs input first: ${input.error.issues.map((issue) => issue.message).join("; ")} Run it from Run to give it some.`,
        );
        return;
      }
      setPhase({ kind: "starting", step });
      try {
        // A test of an App needs the installation of each App the draft names.
        const { apps } = await target.client.catalog();
        const bindings: Record<string, string> = {};
        for (const [alias, binding] of Object.entries(scope.definition.apps)) {
          const matches = apps.filter((app) => app.appId === binding.appId);
          if (matches.length !== 1) {
            if (mine === attempt.current)
              setNotice(
                matches.length === 0
                  ? `${binding.appId} is not installed, so this cannot be tested.`
                  : `More than one ${binding.appId} is installed. Choose one under Run, then test again.`,
              );
            return;
          }
          bindings[alias] = matches[0].installationId;
        }
        const key = JSON.stringify({
          workflowId: target.workflowId,
          revision,
          step,
          allowWrites,
        });
        if (identity.current?.key !== key)
          identity.current = {
            key,
            id: workflowRunRequestIds.request.generate(),
          };
        const request: Parameters<WorkflowClient["testDraft"]>[0] = {
          requestId: identity.current.id,
          workflowId: target.workflowId,
          expectedRevision: revision,
          bindings,
          input: input.data,
        };
        if (step !== undefined) request.step = step;
        if (allowWrites) request.allowWrites = true;
        const reply = await target.client.testDraft(request);
        if (mine !== attempt.current) return;
        if ("kind" in reply && reply.kind === "writes_need_confirmation")
          setPhase({ kind: "confirm", step, writes: reply.steps });
        else if ("kind" in reply && reply.kind === "draft_conflict")
          setNotice(
            "This draft changed since it was saved here. Reload it, then test again.",
          );
        else if (
          "kind" in reply &&
          (reply.kind === "started" || reply.kind === "replay")
        )
          setPhase({
            kind: "running",
            runId: reply.runId,
            step,
            scope: scope.steps,
            before: scope.before,
          });
        else if ("kind" in reply && reply.kind === "invalid")
          setNotice(reply.issues.map((issue) => issue.message).join("; "));
        else if ("error" in reply) setNotice(refusal(reply));
        else setNotice("This test was already started with different choices.");
      } catch (cause) {
        console.error("Workflow test failed to start", cause);
        if (mine === attempt.current)
          setNotice("The test could not start. Try again.");
      }
    },
    [target, definition, revision, setNotice],
  );
  return {
    /** The test, as one word the header and panel agree on. */
    phase: phase.kind,
    /** The tested step, or undefined for the whole workflow. */
    step: "step" in phase ? phase.step : undefined,
    /** The steps a running test covers and how many come before the tested one. */
    scope: phase.kind === "running" ? phase.scope : undefined,
    before: phase.kind === "running" ? phase.before : 0,
    /** The write steps waiting on a person's yes. */
    writes: phase.kind === "confirm" ? phase.writes : [],
    message: phase.kind === "notice" ? phase.message : undefined,
    runId,
    run,
    /** The test run's own recorded step results: what the canvas previews. */
    steps,
    /** The run could not be read; `refresh` tries again. */
    readFailed: error,
    refresh,
    available: target !== undefined,
    /** A test can start: the draft is saved and none is starting. */
    canTest:
      target !== undefined &&
      definition !== undefined &&
      revision !== undefined &&
      phase.kind !== "starting",
    testWorkflow: () => {
      void start(undefined, false);
    },
    testStep: (nodeId: string) => {
      void start(nodeId, false);
    },
    /** The person said yes to the write steps listed; run them for real. */
    confirmWrites: () => {
      if (phase.kind === "confirm") void start(phase.step, true);
    },
    dismiss: () => {
      attempt.current += 1;
      setPhase(idle);
    },
  };
}

export type TestRun = ReturnType<typeof useTestRun>;
