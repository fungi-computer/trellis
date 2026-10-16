import { useMemo } from "react";
import * as z from "zod";
import * as S from "effect/Schema";
import { workflowDefinitionSchema } from "@fungi.computer/braid";
import { workflowClient } from "../src/workflow-client.js";
import { Runs } from "../src/runs/runs.js";
import type { ReadMedia } from "../src/runs/review-card.js";
import "../src/trellis.css";
import "../src/editor/editor.css";
import "@xyflow/react/dist/style.css";

export default { title: "Workflow outputs" };
const image = { destination: { path: "/outputs/garden.png" }, format: "png" };
const text =
  "The release notes are ready for review. Three documents were updated.";
const metadata = { documents: 3, reviewRequired: true };
const definition = S.decodeUnknownSync(workflowDefinitionSchema)({
  format: "fungi.workflow/v1",
  title: "Prepare a release",
  apps: {},
  input: { type: "object", properties: {}, additionalProperties: false },
  nodes: [
    { id: "preview", kind: "transform", fields: { image: { literal: image } } },
    { id: "summary", kind: "transform", fields: { text: { literal: text } } },
    {
      id: "metadata",
      kind: "transform",
      fields: { result: { literal: metadata } },
    },
  ],
  edges: [],
  output: { summary: { node: "summary", port: "text" } },
});
const draft = {
  definition,
  layout: {
    $input: { x: 0, y: 50 },
    preview: { x: 360, y: 50 },
    summary: { x: 720, y: 50 },
    metadata: { x: 720, y: 230 },
  },
  commit: "a".repeat(40),
};
const readMedia: ReadMedia = async (_path, signal) => {
  signal.throwIfAborted();
  const canvas = document.createElement("canvas");
  canvas.width = 640;
  canvas.height = 360;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Fixture image canvas unavailable");
  ctx.fillStyle = "#c6ddd2";
  ctx.fillRect(0, 0, 640, 360);
  ctx.fillStyle = "#385b4f";
  ctx.fillRect(0, 260, 640, 100);
  ctx.fillStyle = "#d0a566";
  for (const [x, y] of [
    [125, 185],
    [320, 130],
    [520, 170],
  ]) {
    ctx.beginPath();
    ctx.arc(x, y, 58, Math.PI, 0);
    ctx.fill();
    ctx.fillRect(x - 8, y, 16, 80);
  }
  ctx.fillStyle = "#203b34";
  ctx.font = "26px sans-serif";
  ctx.fillText("Garden preview", 30, 45);
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (signal.aborted)
        reject(
          new Error("Fixture preview read cancelled", { cause: signal.reason }),
        );
      else if (blob) resolve(blob);
      else reject(new Error("Fixture PNG encoding failed"));
    }, "image/png");
  });
};
function RecordedRun({ failed }: { failed: boolean }) {
  const client = useMemo(
    () =>
      workflowClient({
        call: (method) => {
          if (method === "listRuns")
            return Promise.resolve([
              {
                runId: "release-run",
                workflowId: "release-notes",
                title: draft.definition.title,
                commit: draft.commit,
                version: 2,
                startedAt: Date.UTC(2026, 9, 13, 12),
                source: "manual",
                initiatedBy: { kind: "member", memberId: "workbench-member" },
              },
            ]);
          if (method === "loadWorkflow") return Promise.resolve(draft);
          if (method === "catalog") return Promise.resolve({ apps: [] });
          if (method === "runStatus")
            return Promise.resolve(
              z.json().parse({
                runId: "release-run",
                planDigest: "fixture-digest",
                title: "Prepare a release",
                outcome: "terminal",
                status: failed ? "errored" : "complete",
                reviews: [],
                events: [
                  {
                    nodeId: "preview",
                    iteration: "0",
                    attempt: 0,
                    state: "complete",
                    durationMs: 820,
                    output: { image },
                  },
                  {
                    nodeId: "summary",
                    iteration: "0",
                    attempt: 0,
                    state: "complete",
                    durationMs: 140,
                    output: { text },
                  },
                  {
                    nodeId: "metadata",
                    iteration: "0",
                    attempt: 0,
                    state: failed ? "failed" : "complete",
                    durationMs: 90,
                    ...(failed
                      ? {
                          refusal: "invalid_input",
                          errorMessage: "The document input failed validation.",
                        }
                      : { output: { result: metadata } }),
                  },
                ],
                output: failed ? null : { summary: text },
                error: failed
                  ? {
                      name: "WorkflowStepError",
                      message: "The document input failed validation.",
                    }
                  : null,
              }),
            );
          throw new Error(`Fixture does not execute ${method}`);
        },
      }),
    [failed],
  );
  return (
    <>
      <p role="note">
        Controlled run records · actual Runs renderer · no live provider claim
      </p>
      <Runs
        client={client}
        selectedRun="release-run"
        onSelect={() => undefined}
        readMedia={readMedia}
      />
    </>
  );
}
export function Completed() {
  return <RecordedRun failed={false} />;
}
export function Failed() {
  return <RecordedRun failed />;
}
