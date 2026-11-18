import type { Node, PortSchema } from "@fungi.computer/braid";

/** The pin vocabulary a reader sees. A pin never shows JSON Schema words. */
export type PinToken =
  | "text"
  | "number"
  | "yes-no"
  | "list"
  | "fields"
  | "image"
  | "file-path"
  | "any"
  | "flow";

/** The words for each pin, shared by the legend, popovers and screen readers. */
export const pinWords = {
  text: "Text",
  number: "Number",
  "yes-no": "Yes / no",
  list: "List",
  fields: "Fields",
  image: "Image",
  "file-path": "File path",
  any: "Anything",
  flow: "Order",
} satisfies Record<PinToken, string>;

/** The pin a value port wears. Unions agree only when every branch does. */
export function valuePinToken(schema: PortSchema): Exclude<PinToken, "flow"> {
  if (schema.format === "fungi:image") return "image";
  if (schema.format === "fungi:video" || schema.format === "fungi:file")
    return "file-path";
  const branches = schema.anyOf ?? schema.oneOf;
  if (branches?.length) {
    const tokens = new Set(branches.map(valuePinToken));
    return tokens.size === 1 ? ([...tokens][0] ?? "any") : "any";
  }
  switch (schema.type) {
    case "string":
      return "text";
    case "number":
    case "integer":
      return "number";
    case "boolean":
      return "yes-no";
    case "array":
      return "list";
    case "object":
      return "fields";
    case "null":
      return "any";
    case undefined:
      if (schema.items) return "list";
      if (schema.properties) return "fields";
      return "any";
  }
}

/**
 * Whether a port carries order, not a value: `after`, a condition's
 * `true`/`false`, and a review's choices.
 */
export function isFlowPin(
  node: Node | undefined,
  side: "inputs" | "outputs",
  key: string,
  schema: PortSchema,
) {
  if (key === "after" && Object.keys(schema).length === 0) return true;
  if (!node || side !== "outputs") return false;
  if (node.kind === "condition") return key === "true" || key === "false";
  if (node.kind === "review")
    return node.choices?.length
      ? node.choices.some((choice) => choice.id === key)
      : key === "approved" || key === "rejected";
  return false;
}

export function pinToken(
  node: Node | undefined,
  side: "inputs" | "outputs",
  key: string,
  schema: PortSchema,
): PinToken {
  return isFlowPin(node, side, key, schema) ? "flow" : valuePinToken(schema);
}
