import { useEffect, useState } from "react";
import * as z from "zod";
import { WorkflowEditor } from "../src/editor/editor.js";
import { memoryDraftStore } from "../src/editor/draft-store.js";
import { workflowClient } from "../src/workflow-client.js";
import { ChromeFrame } from "./chrome-frame.js";
import { createProofHost } from "./proof-host.js";
import {
  coverTest,
  redesignAppDisplay,
  redesignCatalog,
  weeklyCover,
} from "./redesign-fixtures.js";
import "@xyflow/react/dist/style.css";
import "../src/trellis.css";
import "../src/editor/editor.css";

export default { title: "Trellis redesign" };

const apps = [
  {
    installationId: "prints-1",
    appId: "Prints",
    displayName: "Prints",
    methods: {},
  },
  {
    installationId: "inkcap-1",
    appId: "Inkcap",
    displayName: "Inkcap",
    methods: {},
  },
];

/**
 * What a test of Hero B records: the prompt, the cover Prints made, and the
 * review it stops at. The real run is the standalone browser proof; this story
 * only draws the screen from a recorded run.
 */
const recorded = z.json().parse({
  runId: "run_story_test",
  planDigest: "digest",
  title: "Weekly cover image",
  outcome: "active",
  status: "running",
  output: null,
  error: null,
  events: [
    {
      nodeId: "prompt",
      iteration: "0",
      state: "complete",
      attempt: 0,
      output: {
        prompt:
          "A quiet moss-covered forest path at dawn, soft light, flat illustration",
      },
    },
    {
      nodeId: "cover",
      iteration: "0",
      state: "complete",
      attempt: 0,
      durationMs: 6100,
      output: { image: "/Prints/weekly-cover.png" },
    },
    { nodeId: "approve", iteration: "0", state: "waiting", attempt: 0 },
  ],
  reviews: [
    {
      status: "pending",
      review: {
        nodeId: "approve",
        iteration: "0",
        title: "Use this cover?",
        show: ["/Prints/weekly-cover.png"],
        choices: ["use", "another", "skip"],
      },
    },
  ],
});

const client = workflowClient({
  call(method) {
    if (method === "catalog") return Promise.resolve(z.json().parse({ apps }));
    if (method === "testDraft")
      return Promise.resolve(
        z.json().parse({
          kind: "started",
          runId: "run_story_test",
          planDigest: "digest",
        }),
      );
    if (method === "runStatus") return Promise.resolve(recorded);
    return Promise.reject(new Error(`Unexpected ${method}`));
  },
});

const picture = new Blob(
  [
    `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="#8fb996"/><text x="12" y="96" font-size="13">${coverTest.alt}</text></svg>`,
  ],
  { type: "image/svg+xml" },
);

/** 08: Test workflow on Hero B; the cover previews on its node and the review stops the test. */
export function TestStep() {
  const [host] = useState(createProofHost);
  const [store] = useState(() =>
    memoryDraftStore(weeklyCover, redesignCatalog, redesignAppDisplay),
  );
  useEffect(() => {
    // The header's Test workflow, pressed as soon as it is ready.
    const timer = window.setInterval(() => {
      const command = host.published().menu?.find(({ id }) => id === "test");
      if (command === undefined || command.disabled === true) return;
      window.clearInterval(timer);
      void host.activate({ kind: "action", actionId: "test" });
    }, 100);
    return () => {
      window.clearInterval(timer);
    };
  }, [host]);
  return (
    <ChromeFrame host={host}>
      <WorkflowEditor
        store={store}
        active
        test={{ client, workflowId: "weekly-cover" }}
        readMedia={() => Promise.resolve(picture)}
      />
    </ChromeFrame>
  );
}
