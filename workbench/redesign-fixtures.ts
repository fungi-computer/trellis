import type {
  Catalog,
  JsonSchemaProjection,
  WorkflowDefinition,
} from "@fungi.computer/braid";
import type { Draft } from "../src/editor/draft-store.js";
import type { RunStatus } from "../src/runs/run-state.js";

/**
 * Trellis redesign fixtures: the shared data of the redesign SPEC §5.3, in the
 * shapes Trellis reads (Draft, RunStatus, Catalog and appDisplay). UI proof
 * only: the catalog states the ports the redesign screens draw, and is not a
 * claim about any deployed App's method. Every draft validates against it
 * (test/redesign-fixtures.test.ts). Later slices keep their extra data in
 * their own story file.
 */

const text = { type: "string" } as const;
const whole = { type: "integer" } as const;
const object = (
  properties: Readonly<Record<string, JsonSchemaProjection>>,
  required: readonly string[] = Object.keys(properties),
): JsonSchemaProjection => ({
  type: "object",
  properties,
  required: [...required],
  additionalProperties: false,
});

const change = object({
  number: whole,
  title: text,
  repository: text,
  revision: text,
});

export const redesignCatalog: Catalog = {
  Bonsai: {
    methods: {
      "checks.report": {
        description: "Report a check on a change",
        digest: "fixture-bonsai-checks-report",
        effect: "write",
        approval: "none",
        requires: [],
        input: object(
          { repository: text, revision: text, state: text, summary: text },
          ["repository", "revision", "state"],
        ),
        output: object({}),
      },
    },
    events: {
      "change.opened": {
        description: "A change opens",
        digest: "fixture-bonsai-change-opened",
        payload: object({ change }),
      },
      "change.updated": {
        description: "A change is updated",
        digest: "fixture-bonsai-change-updated",
        payload: object({ change }),
      },
    },
  },
  Shed: {
    methods: {
      runCommand: {
        description: "Run a command on a Computer",
        digest: "fixture-shed-run-command",
        effect: "write",
        approval: "none",
        requires: [],
        input: object({ command: text, computer: text }),
        output: object({ exitCode: whole, output: text }),
      },
    },
  },
  Prints: {
    methods: {
      generateImage: {
        description: "Generate an image",
        digest: "fixture-prints-generate-image",
        effect: "external",
        approval: "none",
        requires: [],
        input: object({
          prompt: text,
          model: text,
          width: whole,
          height: whole,
        }),
        output: object({ image: { type: "string", format: "fungi:image" } }),
      },
    },
  },
  Inkcap: {
    methods: {
      writeFile: {
        description: "Write a file",
        digest: "fixture-inkcap-write-file",
        effect: "write",
        approval: "none",
        requires: [],
        input: object({
          path: { type: "string", format: "fungi:file" },
          // SPEC §5.3 says "text", but braid refuses an image wire into a text
          // pin (the screen 06 mismatch), so this valid hand-built wire takes an image.
          content: { type: "string", format: "fungi:image" },
        }),
        output: object({ written: { type: "string", format: "fungi:file" } }),
      },
    },
  },
  Grove: {
    methods: {
      sendMessage: {
        description: "Send a message to a chat",
        digest: "fixture-grove-send-message",
        effect: "write",
        approval: "none",
        requires: [],
        input: object({ channel: text, text }),
        output: object({ messageId: text }),
      },
    },
  },
};

export const redesignAppDisplay = {
  Bonsai: { displayName: "Bonsai", icon: "bonsai" },
  Shed: { displayName: "Shed", icon: "computer" },
  Prints: { displayName: "Prints", icon: "prints" },
  Inkcap: { displayName: "Inkcap", icon: "inkcap" },
  Grove: { displayName: "Grove", icon: "chat" },
} as const;

const from = (node: string, port: string) => ({ from: { node, port } });
const wire = (a: string, ap: string, b: string, bp: string) => ({
  from: { node: a, port: ap },
  to: { node: b, port: bp },
});

const changeEvent = (id: "opened" | "updated") =>
  ({
    id,
    on: "event",
    app: "bonsai",
    event: "change." + id,
    eventDigest: "fixture-bonsai-change-" + id,
    input: {
      change: { from: { node: "$input", port: "payload" }, path: "/change" },
    },
    repository: {
      from: { node: "$input", port: "payload" },
      path: "/change/repository",
    },
  }) as const;

const checkEachChangeDefinition: WorkflowDefinition = {
  format: "fungi.workflow/v1",
  title: "Check each change",
  apps: { bonsai: { appId: "Bonsai" }, shed: { appId: "Shed" } },
  input: object({ change }),
  triggers: [changeEvent("opened"), changeEvent("updated")],
  nodes: [
    {
      id: "read",
      kind: "code",
      title: "Read the change",
      source:
        "const { change } = await env.INPUT.read({});\nreturn { repository: change.repository, revision: change.revision, number: change.number };",
      input: object({ change }),
      output: object({ repository: text, revision: text, number: whole }),
      values: { change: from("$input", "change") },
    },
    {
      id: "mark",
      kind: "app",
      title: "Mark as running",
      app: "bonsai",
      method: "checks.report",
      methodDigest: "fixture-bonsai-checks-report",
      values: { state: { literal: "running" } },
    },
    {
      id: "tests",
      kind: "app",
      title: "Run npm test",
      app: "shed",
      method: "runCommand",
      methodDigest: "fixture-shed-run-command",
      values: {
        command: { literal: "npm test" },
        computer: { literal: "field-notes" },
      },
    },
    {
      id: "summarise",
      kind: "code",
      title: "Summarise result",
      source:
        'const { exitCode, output } = await env.INPUT.read({});\nreturn { state: exitCode === 0 ? "passed" : "failed", summary: output.slice(-400) };',
      input: object({ exitCode: whole, output: text }),
      output: object({ state: text, summary: text }),
      values: {},
    },
    {
      id: "report",
      kind: "app",
      title: "Report result",
      app: "bonsai",
      method: "checks.report",
      methodDigest: "fixture-bonsai-checks-report",
      values: {},
    },
  ],
  edges: [
    wire("read", "repository", "mark", "repository"),
    wire("read", "revision", "mark", "revision"),
    wire("mark", "after", "tests", "after"),
    wire("tests", "exitCode", "summarise", "exitCode"),
    wire("tests", "output", "summarise", "output"),
    wire("read", "repository", "report", "repository"),
    wire("read", "revision", "report", "revision"),
    wire("summarise", "state", "report", "state"),
    wire("summarise", "summary", "report", "summary"),
  ],
  output: { state: { node: "summarise", port: "state" } },
};

/** Hero A: published v3, switched on. Left to right. */
export const checkEachChange: Draft = {
  definition: checkEachChangeDefinition,
  layout: {
    $input: { x: 0, y: 120 },
    read: { x: 340, y: 120 },
    mark: { x: 680, y: 0 },
    tests: { x: 1020, y: 0 },
    summarise: { x: 1360, y: 0 },
    report: { x: 1700, y: 0 },
  },
};

const utc = (hour: number, minute: number, second = 0) =>
  Date.UTC(2026, 10, 17, hour, minute, second);
const planDigest = "fixture-plan-check-each-change-v3";

/** A run as the Runs views read it, plus what the status line says about it. */
export type RedesignRun = Readonly<{
  status: RunStatus;
  startedBy: string;
  startedAt: string;
  commit: string;
  /** The trigger is not a graph node, so the run records it apart. */
  trigger: Readonly<{ state: "Done"; durationMs: number }>;
  /** The line on the node, by node id. */
  previews: Readonly<Record<string, string>>;
  line: string;
}>;

/** Run #24: live, Run npm test is running. */
export const checkRun24: RedesignRun = {
  status: {
    runId: "run-24",
    planDigest,
    outcome: "active",
    title: "Bonsai change #41 · Add tag filter to notes list",
    status: "running",
    output: null,
    error: null,
    reviews: [],
    events: [
      {
        nodeId: "read",
        iteration: "root",
        attempt: 0,
        state: "complete",
        durationMs: 200,
        recordedAt: utc(11, 19, 1),
      },
      {
        nodeId: "mark",
        iteration: "root",
        attempt: 0,
        state: "complete",
        durationMs: 400,
        recordedAt: utc(11, 19, 2),
      },
      {
        nodeId: "tests",
        iteration: "root",
        attempt: 0,
        state: "running",
        recordedAt: utc(11, 19, 42),
      },
    ],
  },
  startedBy: "Bonsai change #41 · Add tag filter to notes list",
  startedAt: "11:19",
  commit: "a91c3e2",
  trigger: { state: "Done", durationMs: 100 },
  previews: { tests: "✓ src/notes.test.ts (12)\n⟳ src/tags.test.ts" },
  line: "Running · 38s",
};

/** Run #23: failed at Run npm test. */
export const checkRun23: RedesignRun = {
  status: {
    runId: "run-23",
    planDigest,
    outcome: "terminal",
    title: "Bonsai change #40 · Fix culvert map pins",
    status: "failed",
    output: null,
    error: { message: "Shed stopped the command after the 10-minute limit." },
    reviews: [],
    events: [
      {
        nodeId: "read",
        iteration: "root",
        attempt: 0,
        state: "complete",
        durationMs: 200,
        recordedAt: utc(10, 52, 1),
      },
      {
        nodeId: "mark",
        iteration: "root",
        attempt: 0,
        state: "complete",
        durationMs: 400,
        recordedAt: utc(10, 52, 2),
      },
      {
        nodeId: "tests",
        iteration: "root",
        attempt: 0,
        state: "failed",
        durationMs: 600_000,
        recordedAt: utc(11, 2, 2),
        errorMessage: "Shed stopped the command after the 10-minute limit.",
      },
    ],
  },
  startedBy: "Bonsai change #40 · Fix culvert map pins",
  startedAt: "10:52",
  commit: "5be09d1",
  trigger: { state: "Done", durationMs: 100 },
  previews: {},
  line: "Failed at Run npm test · 10m 03s",
};

const weeklyCoverDefinition: WorkflowDefinition = {
  format: "fungi.workflow/v1",
  title: "Weekly cover image",
  apps: { prints: { appId: "Prints" }, inkcap: { appId: "Inkcap" } },
  input: object({ scheduledAt: text }),
  triggers: [
    {
      id: "monday",
      on: "schedule",
      cron: { expression: "0 9 * * 1", timeZone: "Europe/London" },
      input: { scheduledAt: from("$input", "scheduledAt") },
    },
  ],
  nodes: [
    {
      id: "prompt",
      kind: "transform",
      title: "Cover prompt",
      fields: {
        prompt: {
          literal:
            "A quiet moss-covered forest path at dawn, soft light, flat illustration",
        },
      },
    },
    {
      id: "cover",
      kind: "app",
      title: "Make the cover",
      app: "prints",
      method: "generateImage",
      methodDigest: "fixture-prints-generate-image",
      values: {
        model: { literal: "Flux 1 Schnell" },
        width: { literal: 1536 },
        height: { literal: 864 },
      },
    },
    {
      id: "approve",
      kind: "review",
      title: "Use this cover?",
      show: [{ node: "cover", port: "image" }],
      reviewers: "runner",
      timeout: 86_400_000,
      choices: [
        {
          id: "use",
          label: "Use it",
          description: "Inkcap saves it to covers/2026-11-24.png.",
        },
        {
          id: "another",
          label: "Make another",
          description: "Prints makes a new cover, try 2 of 3.",
        },
        {
          id: "skip",
          label: "Skip this week",
          description: "Nothing is saved. Runs again next Monday.",
        },
      ],
    },
    {
      id: "save",
      kind: "app",
      title: "Save the cover",
      app: "inkcap",
      method: "writeFile",
      methodDigest: "fixture-inkcap-write-file",
      values: { path: { literal: "covers/2026-11-24.png" } },
    },
  ],
  edges: [
    wire("prompt", "prompt", "cover", "prompt"),
    wire("approve", "use", "save", "content"),
  ],
  output: { written: { node: "save", port: "written" } },
};

/** Hero B: a draft being hand-built. */
export const weeklyCover: Draft = {
  definition: weeklyCoverDefinition,
  layout: {
    $input: { x: 0, y: 120 },
    prompt: { x: 340, y: 0 },
    cover: { x: 680, y: 0 },
    approve: { x: 1020, y: 0 },
    save: { x: 1360, y: 0 },
  },
};

/** What the tested "Make the cover" node shows. */
export const coverTest = {
  nodeId: "cover",
  alt: "A flat illustration of a moss-covered forest path at dawn, in soft greens and peach light",
  line: "Tested 12s ago · 6.1s · $0.003",
} as const;

const mossDefinition: WorkflowDefinition = {
  ...checkEachChangeDefinition,
  apps: { ...checkEachChangeDefinition.apps, grove: { appId: "Grove" } },
  nodes: [
    ...checkEachChangeDefinition.nodes.map((node) =>
      node.id === "tests" && node.kind === "app"
        ? { ...node, retry: { attempts: 2 } }
        : node,
    ),
    {
      id: "testsFailed",
      kind: "condition",
      title: "Tests failed?",
      test: {
        op: "eq",
        left: from("summarise", "state"),
        right: { literal: "failed" },
      },
    },
    {
      id: "tell",
      kind: "app",
      title: "Tell #field-notes",
      app: "grove",
      method: "sendMessage",
      methodDigest: "fixture-grove-send-message",
      values: {
        channel: { literal: "#field-notes" },
        text: {
          template:
            "Tests failed on change #{{read.number}}: {{summarise.summary}}",
        },
      },
    },
  ],
  edges: [
    ...checkEachChangeDefinition.edges,
    wire("testsFailed", "true", "tell", "after"),
  ],
};

/** Moss's change to Check each change: a draft over v3. */
export const mossChange = {
  actor: "Moss",
  base: "v3",
  request: "If the tests fail, retry once and tell #field-notes in chat.",
  summary: "Moss changed this draft · 1 changed, 2 added · 4m ago",
  changed: [
    { node: "tests", field: "retry", was: "1 attempt", now: "2 attempts" },
  ],
  added: ["testsFailed", "tell"],
  draft: {
    definition: mossDefinition,
    layout: {
      ...checkEachChange.layout,
      testsFailed: { x: 1700, y: 220 },
      tell: { x: 2040, y: 220 },
    },
  } satisfies Draft,
} as const;

const beatItem = object({ beat: text, style: text });

const storyboardDefinition: WorkflowDefinition = {
  format: "fungi.workflow/v1",
  title: "Storyboard",
  apps: { prints: { appId: "Prints" } },
  input: object({
    beats: { type: "array", items: text, maxItems: 12 },
    style: text,
  }),
  nodes: [
    {
      id: "beatItems",
      kind: "transform",
      title: "Beat items",
      fields: {
        items: {
          each: {
            over: from("$input", "beats"),
            maxItems: 12,
            body: {
              object: {
                beat: from("$item", "value"),
                style: from("$input", "style"),
              },
            },
          },
        },
      },
    },
    {
      id: "forEachBeat",
      kind: "map",
      title: "For each beat",
      over: { node: "beatItems", port: "items" },
      body: "beat",
      concurrency: 1,
      maxItems: 12,
    },
    {
      id: "contactSheet",
      kind: "code",
      title: "Contact sheet",
      source:
        'const { shots } = await env.INPUT.read({});\nreturn { sheet: shots.map((shot) => shot.choice).join("\\n") };',
      input: object({ shots: { type: "array" } }),
      output: object({ sheet: text }),
      values: { shots: from("forEachBeat", "items") },
    },
  ],
  edges: [],
  output: { sheet: { node: "contactSheet", port: "sheet" } },
  subgraphs: {
    beat: {
      input: object({ item: beatItem, index: whole }),
      nodes: [
        {
          id: "repeatPanel",
          kind: "repeat",
          title: "Repeat up to 3 times",
          body: "attempt",
          maxRounds: 3,
          until: {
            op: "neq",
            left: from("$input", "choice"),
            right: { literal: "regenerate" },
          },
        },
      ],
      edges: [],
      output: { result: { node: "repeatPanel", port: "result" } },
    },
    attempt: {
      input: object({
        item: beatItem,
        round: { type: "integer", minimum: 0, maximum: 2 },
        previous: { type: "object" },
      }),
      nodes: [
        {
          id: "prepare",
          kind: "code",
          title: "Prepare generation",
          source:
            'const { item } = await env.INPUT.read({});\nreturn { prompt: item.beat + ", " + item.style };',
          input: object({ item: beatItem }),
          output: object({ prompt: text }),
          values: { item: from("$input", "item") },
        },
        {
          id: "panel",
          kind: "app",
          title: "Make a panel",
          app: "prints",
          method: "generateImage",
          methodDigest: "fixture-prints-generate-image",
          values: {
            model: { literal: "Flux 1 Schnell" },
            width: { literal: 1536 },
            height: { literal: 864 },
          },
        },
        {
          id: "keep",
          kind: "review",
          title: "Keep this panel?",
          show: [{ node: "panel", port: "image" }],
          reviewers: "runner",
          timeout: 86_400_000,
          choices: [
            { id: "keep", label: "Keep" },
            { id: "regenerate", label: "Regenerate" },
            { id: "reject", label: "Reject" },
          ],
        },
        {
          id: "decision",
          kind: "transform",
          title: "Review decision",
          fields: { choice: from("keep", "choice") },
        },
      ],
      edges: [wire("prepare", "prompt", "panel", "prompt")],
      output: { choice: { node: "decision", port: "choice" } },
    },
  },
};

/** Storyboard body for screen 16: a collapsed map, a repeat, two frames. */
export const storyboard = {
  draft: {
    definition: storyboardDefinition,
    layout: {
      $input: { x: 0, y: 80 },
      beatItems: { x: 340, y: 80 },
      forEachBeat: { x: 680, y: 80 },
      contactSheet: { x: 1020, y: 80 },
      "beat/repeatPanel": { x: 0, y: 0 },
      "attempt/prepare": { x: 0, y: 0 },
      "attempt/panel": { x: 340, y: 0 },
      "attempt/keep": { x: 680, y: 0 },
      "attempt/decision": { x: 1020, y: 0 },
    },
  } satisfies Draft,
  collapsed: {
    forEachBeat: { line: "12 beats · one at a time", runs: "12 of 12" },
  },
  frames: ["MAKE THE PANEL", "ASK ANA"],
} as const;

export type WorkflowRow = Readonly<{
  name: string;
  starts: string;
  apps: readonly string[];
  switch: "on" | "off" | "by hand";
  note?: string;
  lastRun: Readonly<{ tone: "green" | "coral" | "red"; text: string }> | null;
  nextRun: string | null;
}>;

export const workflowRows: readonly WorkflowRow[] = [
  {
    name: "Check each change",
    starts: "When a Bonsai change opens or updates · field-notes",
    apps: ["Bonsai", "Shed"],
    switch: "on",
    lastRun: { tone: "green", text: "Passed · 14m ago" },
    nextRun: "On the next change",
  },
  {
    name: "Weekly cover image",
    starts: "Every Monday 09:00",
    apps: ["Prints", "Inkcap"],
    switch: "on",
    lastRun: { tone: "coral", text: "Waiting on you · 2h ago" },
    nextRun: "Mon 24 Nov 09:00",
  },
  {
    name: "Nightly test report",
    starts: "Every day 02:00",
    apps: ["Shed", "Grove"],
    switch: "on",
    lastRun: { tone: "red", text: "Failed · 9h ago" },
    nextRun: "Tonight 02:00",
  },
  {
    name: "Build on merge",
    starts: "When main changes in Bonsai · field-notes",
    apps: ["Bonsai"],
    switch: "on",
    lastRun: { tone: "green", text: "Done · yesterday 16:40" },
    nextRun: "On the next merge",
  },
  {
    name: "Storyboard",
    starts: "By hand",
    apps: ["Prints"],
    switch: "by hand",
    lastRun: { tone: "green", text: "Done · 3d ago" },
    nextRun: null,
  },
  {
    name: "Spore print of the day",
    starts: "Every day 08:00",
    apps: ["Prints"],
    switch: "off",
    note: "Draft · not published",
    lastRun: null,
    nextRun: null,
  },
];

export const workflowsHeader = "6 workflows · 4 on · 1 needs you · 1 failed";

export type TemplateCard = Readonly<{
  name: string;
  description: string;
  uses: readonly string[];
}>;

export const templateCards: readonly TemplateCard[] = [
  {
    name: "Your first workflow",
    description: "Writes a note, then asks you whether to keep it.",
    uses: ["Trellis"],
  },
  {
    name: "Check each change",
    description:
      "Runs npm test on each Bonsai change and reports pass or fail on the change.",
    uses: ["Bonsai", "Shed"],
  },
  {
    name: "Build on merge",
    description: "Builds, verifies and installs your App when main changes.",
    uses: ["Bonsai"],
  },
  {
    name: "Storyboard",
    description:
      "Turns beats into image panels in Prints, with a review per beat.",
    uses: ["Prints"],
  },
  {
    name: "Storyboard + Save to git",
    description: "Storyboard, then saves the contact sheet to a repository.",
    uses: ["Prints", "Inkcap", "Bonsai"],
  },
];

/** Team and moment the screens share. */
export const scene = {
  team: "Mossy Labs",
  signedInAs: "Ana",
  timeZone: "Europe/London",
  now: "Mon 17 Nov 2026, 11:20",
  repository: "field-notes",
  agent: "Moss",
} as const;
