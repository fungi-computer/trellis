import { canonicalJson } from "@fungi.computer/braid";
import type { Graph, Node, WorkflowDefinition } from "@fungi.computer/braid";
import * as z from "zod";
import type { Draft } from "./draft-store.js";
import type { NodeMark } from "./canvas.js";

/** One field of a step that differs, with its value in each version. */
export type FieldChange = Readonly<{
  field: string;
  before: z.output<ReturnType<typeof z.json>> | undefined;
  after: z.output<ReturnType<typeof z.json>> | undefined;
}>;
export type DraftDiff = Readonly<{
  /** Steps in the draft that the live version lacks, in draft order. */
  added: readonly string[];
  /** Steps in both whose fields or wiring differ. */
  changed: readonly Readonly<{
    id: string;
    fields: readonly FieldChange[];
  }>[];
  /** Steps the live version has that the draft dropped, in live order. */
  removed: readonly string[];
  wires: Readonly<{ added: number; removed: number }>;
  /** What the canvas marks on the steps it draws; removed steps are ghosts. */
  marks: Readonly<Record<string, NodeMark>>;
  summary: string;
}>;

type Json = z.output<ReturnType<typeof z.json>>;
const fieldsSchema = z.record(z.string(), z.json());

const same = (a: Json | undefined, b: Json | undefined) =>
  a === undefined || b === undefined
    ? a === b
    : canonicalJson(a) === canonicalJson(b);
/** A step or body graph as plain JSON, read at the one place it is compared. */
const asJson = (value: Node | Graph | undefined) =>
  value === undefined ? undefined : z.json().parse(value);

function fieldsOf(before: Node, after: Node): FieldChange[] {
  const was = fieldsSchema.parse(before);
  const now = fieldsSchema.parse(after);
  const keys = new Set([...Object.keys(was), ...Object.keys(now)]);
  keys.delete("id");
  return [...keys]
    .filter((key) => !same(was[key], now[key]))
    .sort()
    .map((field) => ({ field, before: was[field], after: now[field] }));
}

type Edge = WorkflowDefinition["edges"][number];
const edgeKey = (edge: Edge) =>
  `${edge.from.node}.${edge.from.port}>${edge.to.node}.${edge.to.port}`;

function words(count: number, what: string) {
  return count === 0 ? [] : [`${String(count)} ${what}`];
}

/**
 * How a draft differs from the live version, step by step. Pure and about the
 * definition only: layout, run state and comment frames never count.
 */
export function diffDrafts(live: Draft, draft: Draft): DraftDiff {
  const before = live.definition;
  const after = draft.definition;
  const beforeById = new Map(before.nodes.map((node) => [node.id, node]));
  const afterById = new Map(after.nodes.map((node) => [node.id, node]));
  const added = after.nodes
    .filter((node) => !beforeById.has(node.id))
    .map((node) => node.id);
  const removed = before.nodes
    .filter((node) => !afterById.has(node.id))
    .map((node) => node.id);
  const changes = new Map<string, FieldChange[]>();
  for (const node of after.nodes) {
    const previous = beforeById.get(node.id);
    if (previous === undefined) continue;
    const fields = fieldsOf(previous, node);
    // A loop whose body steps changed is a changed step, even if its own
    // fields (which name the body) are not.
    if (
      (node.kind === "map" || node.kind === "repeat") &&
      !same(
        asJson(before.subgraphs?.[node.body]),
        asJson(after.subgraphs?.[node.body]),
      )
    )
      fields.push({
        field: "steps inside",
        before: asJson(before.subgraphs?.[node.body]),
        after: asJson(after.subgraphs?.[node.body]),
      });
    if (fields.length > 0) changes.set(node.id, fields);
  }
  const beforeEdges = new Map(
    before.edges.map((edge) => [edgeKey(edge), edge]),
  );
  const afterEdges = new Map(after.edges.map((edge) => [edgeKey(edge), edge]));
  const addedWires = [...afterEdges].filter(([key]) => !beforeEdges.has(key));
  const removedWires = [...beforeEdges].filter(([key]) => !afterEdges.has(key));
  for (const [, edge] of [...addedWires, ...removedWires])
    for (const id of [edge.from.node, edge.to.node]) {
      if (!beforeById.has(id) || !afterById.has(id)) continue;
      const own = changes.get(id) ?? [];
      if (!own.some((item) => item.field === "connections"))
        changes.set(id, [
          ...own,
          {
            field: "connections",
            before: before.edges
              .filter((e) => e.from.node === id || e.to.node === id)
              .map(edgeKey),
            after: after.edges
              .filter((e) => e.from.node === id || e.to.node === id)
              .map(edgeKey),
          },
        ]);
    }
  const changed = after.nodes
    .filter((node) => changes.has(node.id))
    .map((node) => ({ id: node.id, fields: changes.get(node.id) ?? [] }));
  const marks: Record<string, NodeMark> = {};
  for (const id of added) marks[id] = "added";
  for (const { id } of changed) marks[id] = "changed";
  const parts = [
    ...words(changed.length, "changed"),
    ...words(added.length, "added"),
    ...words(removed.length, "removed"),
  ];
  return {
    added,
    changed,
    removed,
    wires: { added: addedWires.length, removed: removedWires.length },
    marks,
    summary: parts.length === 0 ? "No changes" : parts.join(", "),
  };
}
