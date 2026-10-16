import { Field } from "@fungi.computer/caps/components/field";
import { Textarea } from "@fungi.computer/caps/components/textarea";
import {
  mappingSchema,
  projectionSchema,
  parseProjection,
  methodInputPorts,
  methodOutputPorts,
  ports,
  type CodeNode,
} from "@fungi.computer/braid";
import * as S from "effect/Schema";
import { JsonField } from "./value-field.js";

/** A runnable data-only example; the author may replace its literal mapping. */
export function createCodeNode(id: string): CodeNode {
  const names = { type: "array", items: { type: "string" }, maxItems: 50 };
  return {
    id,
    kind: "code",
    source:
      "const input = await env.INPUT.read({});\nreturn input.names.map((name) => name.trim());",
    input: {
      type: "object",
      properties: { names },
      required: ["names"],
      additionalProperties: false,
    },
    output: names,
    values: { names: { literal: [" Garden "] } },
  };
}

/** The compiler's shared projection owner also names the editor's pins. */
export function codeNodePorts(node: CodeNode) {
  return {
    inputs: ports(methodInputPorts(parseProjection(node.input))),
    outputs: methodOutputPorts(parseProjection(node.output)),
  };
}

export function CodeFields({
  node,
  onChange,
}: {
  node: CodeNode;
  onChange: (node: CodeNode) => void;
}) {
  return (
    <>
      <Field
        label="JavaScript"
        description="Read your mapped input with env.INPUT.read({}), then return a JSON value."
      >
        <Textarea
          aria-label="Code source"
          rows={8}
          value={node.source}
          onChange={(event) => {
            onChange({ ...node, source: event.currentTarget.value });
          }}
        />
      </Field>
      <JsonField
        label="Code input schema"
        value={node.input}
        schema={projectionSchema}
        onChange={(input) => {
          onChange({ ...node, input });
        }}
      />
      <JsonField
        label="Code output schema"
        value={node.output}
        schema={projectionSchema}
        onChange={(output) => {
          onChange({ ...node, output });
        }}
      />
      <JsonField
        label="Code input mappings"
        value={node.values}
        schema={S.Record(S.String, mappingSchema)}
        onChange={(values) => {
          onChange({ ...node, values });
        }}
      />
    </>
  );
}
