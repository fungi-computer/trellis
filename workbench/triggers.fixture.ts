import { emptyDraft, type Draft } from "../src/editor/draft-store.js";
import { workflowClient } from "../src/workflow-client.js";
import type { TriggerControl } from "../src/triggers/triggers.js";

/** Local method-boundary fake. No run executes and no trigger is durably armed. */
export function triggerUiFixture(input?: Draft["definition"]["input"]) {
  const base = emptyDraft();
  const draft: Draft = {
    ...base,
    definition: {
      ...base.definition,
      title: "Storyboard",
      apps: { bonsai: { appId: "Bonsai" } },
      input: input ?? {
        type: "object",
        properties: {
          beats: {
            type: "array",
            minItems: 1,
            maxItems: 12,
            items: { type: "string", minLength: 1, maxLength: 512 },
            description: "One panel per beat.",
          },
          aspect: {
            type: "string",
            enum: ["16:9", "9:16", "1:1"],
            default: "16:9",
            description: "The shape of each panel.",
          },
          style: {
            type: "object",
            description: "Optional guidance for the panels.",
            properties: {
              notes: {
                type: "string",
                description: "Describe the look and feel.",
              },
            },
          },
        },
        required: ["beats"],
        additionalProperties: false,
      },
      triggers: input
        ? []
        : [
            {
              id: "daily",
              on: "schedule",
              title: "Morning storyboard",
              cron: { expression: "0 9 * * 1-5", timeZone: "Europe/London" },
              input: {
                beats: { literal: ["A pond at sunrise"] },
                aspect: { literal: "16:9" },
              },
            },
            {
              id: "change",
              on: "event",
              title: "New Change",
              app: "bonsai",
              event: "change.opened",
              eventDigest: "change-v1",
              input: {
                beats: { literal: ["A pond at sunrise"] },
                aspect: { literal: "16:9" },
              },
            },
          ],
    },
  };
  const catalog = {
    Bonsai: {
      methods: {},
      events: {
        "change.opened": {
          digest: "change-v1",
          description: "A Change was opened",
          payload: {
            type: "object",
            properties: { title: { type: "string" } },
            required: ["title"],
          },
        },
      },
    },
  };
  const client = workflowClient({
    call: (method) => {
      if (method === "listVersions")
        return Promise.resolve([
          {
            version: 1,
            commit: "a".repeat(40),
            committedAt: 1,
            message: "Publish v1",
          },
        ]);
      if (method === "loadWorkflow")
        return Promise.resolve({ ...draft, commit: "a".repeat(40) });
      if (method === "catalog")
        return Promise.resolve({
          apps: [
            {
              appId: "Bonsai",
              installationId: "bonsai-local",
              displayName: "Bonsai",
              methods: {},
            },
          ],
        });
      if (method === "runWorkflow")
        return Promise.resolve({
          kind: "started",
          runId: "local-ui-run",
          planDigest: "fixture-plan",
        });
      throw new Error(`Unexpected fixture operation: ${method}`);
    },
  });
  let rows: Awaited<ReturnType<TriggerControl["list"]>> = [
    { triggerId: "daily", state: "active", lastError: null },
    {
      triggerId: "change",
      state: "paused",
      lastError: "The selected App installation is no longer available.",
    },
  ];
  const control: TriggerControl = {
    list: () => Promise.resolve(rows),
    arm: (triggerId) => {
      rows = [
        ...rows.filter((row) => row.triggerId !== triggerId),
        { triggerId, state: "active", lastError: null },
      ];
      return Promise.resolve({ kind: "armed" });
    },
    disarm: (triggerId) => {
      rows = rows.filter((row) => row.triggerId !== triggerId);
      return Promise.resolve({ kind: "disarmed" });
    },
  };
  return { draft, catalog, client, control };
}
