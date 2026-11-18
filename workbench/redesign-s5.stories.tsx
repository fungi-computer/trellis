import { useMemo } from "react";
import * as z from "zod";
import { workflowClient } from "../src/workflow-client.js";
import { Runs } from "../src/runs/runs.js";
import type { ReadMedia } from "../src/runs/output-preview.js";
import type { Draft } from "../src/editor/draft-store.js";
import {
  checkEachChange,
  checkRun23,
  checkRun24,
  coverRun1,
  redesignAppDisplay,
  redesignCatalog,
  weeklyCover,
  type RedesignRun,
} from "./redesign-fixtures.js";
import "@xyflow/react/dist/style.css";
import "../src/trellis.css";
import "../src/editor/editor.css";

export default { title: "Trellis redesign" };

const displayNames = new Map(
  Object.entries(redesignAppDisplay).map(([appId, { displayName }]) => [
    appId,
    displayName,
  ]),
);
const installation = (appId: string) => `${appId.toLowerCase()}-local`;

/** The cover the review shows: a dawn path in soft greens and peach. */
const readMedia: ReadMedia = async (_path, signal) => {
  signal.throwIfAborted();
  const canvas = document.createElement("canvas");
  canvas.width = 1280;
  canvas.height = 720;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Fixture image canvas unavailable");
  const sky = ctx.createLinearGradient(0, 0, 0, 720);
  sky.addColorStop(0, "#f6d9c0");
  sky.addColorStop(0.55, "#cfe3cf");
  sky.addColorStop(1, "#7fa88a");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, 1280, 720);
  ctx.fillStyle = "#4f7a5f";
  ctx.beginPath();
  ctx.moveTo(0, 720);
  ctx.lineTo(540, 330);
  ctx.lineTo(740, 330);
  ctx.lineTo(1280, 720);
  ctx.fill();
  ctx.fillStyle = "#2f5440";
  for (const [x, h] of [
    [90, 420],
    [250, 520],
    [1010, 500],
    [1170, 400],
  ])
    ctx.fillRect(x, 720 - h, 46, h);
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (signal.aborted) reject(new Error("Fixture image read cancelled"));
      else if (blob) resolve(blob);
      else reject(new Error("Fixture PNG encoding failed"));
    }, "image/png");
  });
};

/** An earlier run that went through: every step of the draft done. */
function passed(run: RedesignRun, runId: string, title: string): RedesignRun {
  return {
    ...run,
    status: {
      ...run.status,
      runId,
      title,
      outcome: "terminal",
      status: "complete",
      error: null,
      events: ["read", "mark", "tests", "summarise", "report"].map(
        (nodeId, index) => ({
          nodeId,
          iteration: "root",
          attempt: 0,
          state: "complete" as const,
          durationMs: 400 + index * 2_000,
          output: {},
        }),
      ),
    },
  };
}

/**
 * The real Runs renderer over recorded runs: the transport answers from the
 * redesign fixtures, nothing executes. The list, the canvas and the panel are
 * the production ones.
 */
function RunStage({
  draft,
  workflowId,
  title,
  version,
  runs,
  selected,
}: {
  draft: Draft;
  workflowId: string;
  title: string;
  version: number;
  runs: readonly RedesignRun[];
  selected: string;
}) {
  const client = useMemo(
    () =>
      workflowClient({
        call: (method, text) => {
          const input: unknown = JSON.parse(text);
          switch (method) {
            case "listRuns":
              return Promise.resolve(
                runs.map(({ status, commit }, index) => ({
                  runId: status.runId,
                  workflowId,
                  title,
                  commit: commit.padEnd(40, "0"),
                  version,
                  startedAt: Date.now() - index * 3_600_000,
                  source: "manual",
                  initiatedBy: { kind: "member", memberId: "ana" },
                })),
              );
            case "loadWorkflow":
              return Promise.resolve(
                z.json().parse({ ...draft, commit: "a".repeat(40) }),
              );
            case "viewerId":
              return Promise.resolve({ memberId: "ana" });
            case "catalog": {
              const { installationId } = z
                .object({ installationId: z.string().optional() })
                .parse(input);
              const apps = Object.entries(redesignCatalog).map(
                ([appId, app]) => ({ appId, app }),
              );
              if (installationId === undefined)
                return Promise.resolve({
                  apps: apps.map(({ appId }) => ({
                    appId,
                    installationId: installation(appId),
                    displayName: displayNames.get(appId) ?? appId,
                    methods: {},
                  })),
                });
              const found = apps.find(
                ({ appId }) => installation(appId) === installationId,
              );
              if (!found) return Promise.resolve({ error: "not_found" });
              const full = {
                appId: found.appId,
                installationId,
                displayName: found.appId,
                methods: found.app.methods,
              };
              return Promise.resolve(
                z.json().parse({
                  app:
                    "events" in found.app
                      ? { ...full, events: found.app.events }
                      : full,
                }),
              );
            }
            case "runStatus": {
              const { runId } = z.object({ runId: z.string() }).parse(input);
              const run = runs.find(({ status }) => status.runId === runId);
              if (!run) return Promise.resolve({ error: "not_found" });
              // The line a step shows on its card is its recorded output.
              return Promise.resolve(
                z.json().parse({
                  ...run.status,
                  events: run.status.events.map((event) => {
                    const preview = new Map(Object.entries(run.previews)).get(
                      event.nodeId,
                    );
                    return preview === undefined
                      ? event
                      : { ...event, output: { output: preview } };
                  }),
                }),
              );
            }
            default:
              throw new Error(`Fixture does not serve ${method}`);
          }
        },
      }),
    [draft, runs, title, version, workflowId],
  );
  return (
    <div
      className="wf-workspace"
      style={{
        display: "flex",
        flexDirection: "column",
        position: "fixed",
        inset: 0,
        background: "var(--color-base-200)",
      }}
    >
      <Runs
        client={client}
        workflowId={workflowId}
        selectedRun={selected}
        onSelect={() => undefined}
        readMedia={readMedia}
      />
    </div>
  );
}

const checkRuns = [
  checkRun24,
  checkRun23,
  passed(checkRun24, "run-22", "Bonsai change #39 · Rename the notes tab"),
  passed(checkRun24, "run-21", "Bonsai change #38 · Tidy the tag styles"),
];
const checkStage = (selected: string) => (
  <RunStage
    draft={checkEachChange}
    workflowId="check-each-change"
    title="Check each change"
    version={3}
    runs={checkRuns}
    selected={selected}
  />
);

/** 11: a run lighting up the graph. Run npm test is running; the steps after it are not yet. */
export function RunLive() {
  return checkStage("run-24");
}

/** 12: a failed run. The failed step is ringed and says why on the step; the panel says what happened. */
export function RunFailed() {
  return checkStage("run-23");
}

/** 13: a review waits on its step; the question, the cover and the choices are in the right panel. */
export function ReviewWaiting() {
  return (
    <RunStage
      draft={weeklyCover}
      workflowId="weekly-cover-image"
      title="Weekly cover image"
      version={1}
      runs={[coverRun1]}
      selected="cover-run-1"
    />
  );
}

/** 18: the phone. The steps are one row and the review is the full-width page. */
export function PhoneRun() {
  return (
    <RunStage
      draft={weeklyCover}
      workflowId="weekly-cover-image"
      title="Weekly cover image"
      version={1}
      runs={[coverRun1]}
      selected="cover-run-1"
    />
  );
}
