import type {
  Catalog,
  Mapping,
  Node,
  PortRef,
  WorkflowDefinition,
} from "@fungi.computer/braid";
import { createCodeNode } from "./code-node.js";
import type { Draft, DraftDocument, Palette } from "./draft-store.js";
import { addNode, connect, nodePorts, portOf } from "./graph.js";
import { humanTitle } from "./human-title.js";
import { isFlowPin, pinToken, type PinToken } from "./pins.js";

/*
 * What can be added to a workflow, how a search finds it, which of it fits a
 * pin, and how a refused wire can be mended. Presentation lives in
 * step-search.tsx; every decision about a step lives here.
 */

/** One step a person can add: an installed App's method or a control step. */
export type StepEntry = Readonly<{
  key: string;
  /** The App id for a method, `Control` for the built-in steps. */
  group: string;
  appId: string | null;
  method: string | null;
  name: string;
  description: string;
  create: (id: string, apps: WorkflowDefinition["apps"]) => Node;
}>;

const controlSteps: readonly StepEntry[] = [
  {
    key: "review",
    group: "Control",
    appId: null,
    method: null,
    name: "Review",
    description: "Pause for a human decision",
    create: (id) => ({
      id,
      kind: "review",
      title: "Keep this result?",
      show: [],
      reviewers: "runner",
      timeout: 86400000,
    }),
  },
  {
    key: "wait",
    group: "Control",
    appId: null,
    method: null,
    name: "Wait",
    description: "Wait before continuing",
    create: (id) => ({ id, kind: "wait", for: 1000 }),
  },
  {
    key: "condition",
    group: "Control",
    appId: null,
    method: null,
    name: "Condition",
    description: "Choose a branch",
    create: (id) => ({
      id,
      kind: "condition",
      test: { op: "exists", value: { literal: null } },
    }),
  },
  {
    key: "map",
    group: "Control",
    appId: null,
    method: null,
    name: "Map",
    description: "Apply a graph to each item",
    create: (id) => ({
      id,
      kind: "map",
      over: { node: "$input", port: "items" },
      body: `${id}Body`,
      concurrency: 1,
      maxItems: 10,
    }),
  },
  {
    key: "repeat",
    group: "Control",
    appId: null,
    method: null,
    name: "Repeat",
    description: "Revise an item until a stop condition is met",
    create: (id) => ({
      id,
      kind: "repeat",
      body: `${id}Body`,
      maxRounds: 3,
      until: {
        op: "exists",
        value: { from: { node: "$input", port: "result" } },
      },
    }),
  },
  {
    key: "transform",
    group: "Control",
    appId: null,
    method: null,
    name: "Transform",
    description: "Shape values without code",
    create: (id) => ({ id, kind: "transform", fields: {} }),
  },
  {
    key: "code",
    group: "Control",
    appId: null,
    method: null,
    name: "Code",
    description: "Reshape mapped JSON",
    create: createCodeNode,
  },
];

/** Every installed App's methods, then the control steps. */
export function stepEntries(
  palette: Palette,
  apps: WorkflowDefinition["apps"],
): readonly StepEntry[] {
  return [
    ...Object.entries(palette).flatMap(([appId, methods]) =>
      Object.entries(methods).map(([method, spec]): StepEntry => ({
        key: `${appId}/${method}`,
        group: appId,
        appId,
        method,
        name: humanTitle(method),
        description: spec.description,
        create: (id, current) => ({
          id,
          kind: "app",
          app:
            Object.entries({ ...apps, ...current }).find(
              ([, app]) => app.appId === appId,
            )?.[0] ?? id,
          method,
          methodDigest: spec.digest,
          values: {},
        }),
      })),
    ),
    ...controlSteps,
  ];
}

const wordStart = (text: string, word: string) =>
  text.split(/[^a-z0-9]+/u).some((part) => part.startsWith(word));

/** Lower is better; `undefined` is no match. */
function score(
  entry: StepEntry,
  word: string,
  display: DraftDocument["appDisplay"],
): number | undefined {
  const name = entry.name.toLowerCase();
  const app = (display[entry.group]?.displayName ?? entry.group).toLowerCase();
  const description = entry.description.toLowerCase();
  if (name.startsWith(word)) return 0;
  if (wordStart(name, word)) return 1;
  if (name.includes(word)) return 2;
  if (app.startsWith(word) || app.includes(word)) return 3;
  if (entry.method?.toLowerCase().includes(word)) return 4;
  if (wordStart(description, word)) return 4;
  if (description.includes(word)) return 5;
  return undefined;
}

/**
 * Steps matching every word of the query, best first; equal matches keep the
 * catalog's order. An empty query keeps everything.
 */
export function searchSteps(
  entries: readonly StepEntry[],
  query: string,
  display: DraftDocument["appDisplay"],
): readonly StepEntry[] {
  const words = query.toLowerCase().split(/\s+/u).filter(Boolean);
  if (words.length === 0) return entries;
  return entries
    .flatMap((entry, index) => {
      let total = 0;
      for (const word of words) {
        const found = score(entry, word, display);
        if (found === undefined) return [];
        total += found;
      }
      return [{ entry, index, total }];
    })
    .sort((left, right) => left.total - right.total || left.index - right.index)
    .map(({ entry }) => entry);
}

const maxSteps = 64;

function nextNodeId(scoped: Draft) {
  let index = 1;
  while (
    scoped.definition.nodes.some((node) => node.id === `node${String(index)}`)
  )
    index += 1;
  return `node${String(index)}`;
}

/** Adds a step at a place on the canvas, with its App and loop body. */
export function placeStep(
  scoped: Draft,
  entry: StepEntry,
  point: { readonly x: number; readonly y: number },
):
  | { readonly ok: true; readonly draft: Draft; readonly node: Node }
  | { readonly ok: false; readonly message: string } {
  if (scoped.definition.nodes.length >= maxSteps)
    return {
      ok: false,
      message: `A workflow can contain at most ${String(maxSteps)} nodes.`,
    };
  const node = entry.create(nextNodeId(scoped), scoped.definition.apps);
  let next = addNode(scoped, node, { x: point.x, y: point.y });
  if (node.kind === "app" && entry.appId)
    next = {
      ...next,
      definition: {
        ...next.definition,
        apps: { ...next.definition.apps, [node.app]: { appId: entry.appId } },
      },
    };
  if (node.kind === "map" || node.kind === "repeat")
    next = {
      ...next,
      definition: {
        ...next.definition,
        subgraphs: {
          ...next.definition.subgraphs,
          [node.body]: {
            input: {
              type: "object",
              properties:
                node.kind === "map"
                  ? { item: {}, index: { type: "integer" } }
                  : {
                      item: {},
                      round: {
                        type: "integer",
                        minimum: 0,
                        maximum: node.maxRounds - 1,
                      },
                      previous: { type: "object" },
                    },
              required:
                node.kind === "map"
                  ? ["item", "index"]
                  : ["item", "round", "previous"],
              additionalProperties: false,
            },
            nodes: [],
            edges: [],
            output: {},
          },
        },
      },
    };
  return { ok: true, draft: next, node };
}

/** A step with an input that takes the pin, and which input that is. */
export type PinFit = Readonly<{
  entry: StepEntry;
  port: string;
  pin: PinToken;
}>;

/**
 * The steps that could take a wire from this output pin, each with the input
 * it would land on. Every answer is `connect()`'s: a step is listed only if
 * the wire would be accepted. An App whose ports are not loaded is skipped
 * rather than guessed at. An order pin leads only into an order input, and a
 * value pin never into one.
 */
export function fitsPin(
  draft: Draft,
  catalog: Catalog,
  entries: readonly StepEntry[],
  from: PortRef,
): readonly PinFit[] {
  const schema = portOf(
    nodePorts(draft.definition, catalog, from.node).outputs,
    from.port,
  );
  if (!schema) return [];
  const leads = isFlowPin(
    draft.definition.nodes.find((node) => node.id === from.node),
    "outputs",
    from.port,
    schema,
  );
  return entries.flatMap((entry): readonly PinFit[] => {
    // An App whose ports are not loaded cannot be asked.
    if (
      entry.appId !== null &&
      entry.method !== null &&
      !(
        Object.hasOwn(catalog, entry.appId) &&
        Object.hasOwn(catalog[entry.appId].methods, entry.method)
      )
    )
      return [];
    const placed = placeStep(draft, entry, { x: 0, y: 0 });
    if (!placed.ok) return [];
    const inputs = nodePorts(
      placed.draft.definition,
      catalog,
      placed.node.id,
    ).inputs;
    for (const [port, input] of Object.entries(inputs)) {
      if ((port === "after") !== leads) continue;
      if (
        !connect(placed.draft, catalog, from, { node: placed.node.id, port }).ok
      )
        continue;
      return [
        { entry, port, pin: pinToken(placed.node, "inputs", port, input) },
      ];
    }
    return [];
  });
}

/** A way to make a refused wire work by putting a Transform step in between. */
export type MismatchOffer = Readonly<{
  kind: "path" | "transform";
  label: string;
  /** The draft with the Transform step added and wired both ways. */
  draft: Draft;
}>;

const pointerKey = (key: string) =>
  key.replaceAll("~", "~0").replaceAll("/", "~1");
const fileNouns = new Map([
  ["fungi:image", "image"],
  ["fungi:video", "video"],
  ["fungi:file", "file"],
]);

/**
 * What a Transform step can do about a wire the types refuse. An offer exists
 * only where a Transform mapping can express it and the result is accepted by
 * `connect()`: the path of an image, video or file as text; a number or yes /
 * no as text; a value as a one-item list; one required field of a record.
 */
export function mismatchOffers(
  draft: Draft,
  catalog: Catalog,
  from: PortRef,
  to: PortRef,
  at: { readonly x: number; readonly y: number },
): readonly MismatchOffer[] {
  const target = draft.definition.nodes.find((node) => node.id === to.node);
  if (target?.kind !== "app" && target?.kind !== "code") return [];
  const source = portOf(
    nodePorts(draft.definition, catalog, from.node).outputs,
    from.port,
  );
  const wanted = portOf(
    nodePorts(draft.definition, catalog, to.node).inputs,
    to.port,
  );
  if (!source || !wanted || to.port === "after") return [];
  if (draft.definition.nodes.length >= maxSteps) return [];
  const id = nextNodeId(draft);
  const piece: PortRef = { node: id, port: "value" };
  const through = (mapping: Mapping) => {
    const added = addNode(
      draft,
      { id, kind: "transform", fields: { value: mapping } } satisfies Node,
      { x: at.x, y: at.y },
    );
    const result = connect(added, catalog, piece, to);
    return result.ok ? result.draft : undefined;
  };
  const plainText = wanted.type === "string" && wanted.format === undefined;
  const reference = `{{${from.node}.${from.port}}}`;
  const noun =
    source.format === undefined ? undefined : fileNouns.get(source.format);
  const offers: MismatchOffer[] = [];
  if (noun !== undefined && plainText) {
    const result = through({ template: reference });
    if (result)
      offers.push({
        kind: "path",
        label: `Use the ${noun}'s path instead`,
        draft: result,
      });
  } else if (noun === undefined) {
    const recipes: Mapping[] = [];
    if (
      plainText &&
      (source.type === "number" ||
        source.type === "integer" ||
        source.type === "boolean")
    )
      recipes.push({ template: reference });
    if (wanted.type === "array" && source.type !== "array")
      recipes.push({ array: [{ from }] });
    if (source.type === "object")
      for (const key of source.required ?? [])
        recipes.push({ from, path: `/${pointerKey(key)}` });
    for (const recipe of recipes) {
      const result = through(recipe);
      if (!result) continue;
      offers.push({
        kind: "transform",
        label: "Insert a Transform step",
        draft: result,
      });
      break;
    }
  }
  return offers;
}
