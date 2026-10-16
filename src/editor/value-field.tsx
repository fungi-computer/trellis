import { Field } from "@fungi.computer/caps/components/field";
import { Input } from "@fungi.computer/caps/components/input";
import { Select } from "@fungi.computer/caps/components/select";
import { Textarea } from "@fungi.computer/caps/components/textarea";
import type { Json, PortSchema } from "@fungi.computer/braid";
import * as S from "effect/Schema";
import { useEffect, useState } from "react";

export type Value = { readonly literal: Json } | { readonly template: string };
const render = (value: Value | undefined) =>
  value
    ? "template" in value
      ? value.template
      : S.is(S.String)(value.literal)
        ? value.literal
        : JSON.stringify(value.literal)
    : "";

/** Raw text belongs to the field until it parses; incomplete JSON never erases a typed value. */
export function ValueField({
  label,
  schema,
  value,
  onChange,
  id,
}: {
  label: string;
  schema: PortSchema;
  value: Value | undefined;
  onChange: (value: Value) => void;
  id?: string;
}) {
  const [text, setText] = useState(() => render(value));
  const [template, setTemplate] = useState(
    value !== undefined && "template" in value,
  );
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    setText(render(value));
    setTemplate(value !== undefined && "template" in value);
    setError(null);
  }, [value]);
  const edit = (next: string, isTemplate = template) => {
    setText(next);
    try {
      const parsed: Value = isTemplate
        ? { template: next }
        : {
            literal:
              schema.type === "string" || !schema.type
                ? next
                : S.decodeUnknownSync(S.fromJsonString(S.Json))(next),
          };
      setError(null);
      onChange(parsed);
    } catch (cause) {
      setError(cause);
    }
  };
  return (
    <Field
      label={id ? undefined : label}
      description={schema.description}
      error={
        error ? "Enter valid JSON; the last valid value is kept." : undefined
      }
    >
      {!template && (schema.enum || schema.type === "boolean") ? (
        <Select
          aria-label={label}
          id={id}
          value={text}
          onChange={(event) => {
            edit(event.currentTarget.value);
          }}
        >
          <option value="">Choose…</option>
          {(schema.enum ?? [true, false]).map((item) => {
            const formatted = S.is(S.String)(item)
              ? item
              : JSON.stringify(item);
            return (
              <option key={formatted} value={formatted}>
                {formatted}
              </option>
            );
          })}
        </Select>
      ) : schema.type === "object" || schema.type === "array" ? (
        <Textarea
          aria-label={label}
          id={id}
          value={text}
          rows={4}
          onChange={(event) => {
            edit(event.currentTarget.value);
          }}
        />
      ) : (
        <Input
          aria-label={label}
          id={id}
          value={text}
          onChange={(event) => {
            edit(event.currentTarget.value);
          }}
        />
      )}
    </Field>
  );
}

/** Effect owns the JSON grammar of declarative control fields. */
export function JsonField<A>({
  label,
  value,
  schema,
  onChange,
}: {
  label: string;
  value: A;
  schema: S.Codec<A>;
  onChange: (value: A) => void;
}) {
  const [text, setText] = useState(() => JSON.stringify(value, null, 2));
  const [error, setError] = useState<unknown>(null);
  return (
    <Field
      label={label}
      error={error ? "This JSON does not match the field schema." : undefined}
    >
      <Textarea
        rows={6}
        value={text}
        onChange={(event) => {
          const next = event.currentTarget.value;
          setText(next);
          try {
            const parsed = S.decodeUnknownSync(S.fromJsonString(schema))(next);
            setError(null);
            onChange(parsed);
          } catch (cause) {
            setError(cause);
          }
        }}
      />
    </Field>
  );
}
