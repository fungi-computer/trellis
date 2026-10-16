import { useEffect, useId, useRef, useState } from "react";
import * as S from "effect/Schema";
import * as z from "zod";
import { encodePointer } from "@cfworker/json-schema";
import { field, type FieldRenderProps } from "@fungi.computer/caps/form";
import { Field, FieldSet } from "@fungi.computer/caps/components/field";
import { Textarea } from "@fungi.computer/caps/components/textarea";
import { Input } from "@fungi.computer/caps/components/input";
import { Select } from "@fungi.computer/caps/components/select";
import { Button } from "@fungi.computer/caps/components/button";
import {
  admitRunInput,
  accepts,
  type Json,
  type PortSchema,
} from "@fungi.computer/braid";

const nameOf = (name: string) => {
  const words = name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
};
const singular = (name: string) =>
  name.endsWith("ies")
    ? `${name.slice(0, -3)}y`
    : name.endsWith("s")
      ? name.slice(0, -1)
      : name;

/** Initial form values are presentation only; the run owner re-admits submitted input. */
function initial(schema: PortSchema): Json {
  if (schema.const !== undefined) return schema.const;
  if (schema.default !== undefined) return schema.default;
  if (schema.type === "object")
    return Object.fromEntries(
      Object.entries(schema.properties ?? {}).flatMap(([key, child]) =>
        child.default !== undefined || schema.required?.includes(key)
          ? [[key, initial(child)]]
          : [],
      ),
    );
  if (schema.type === "array")
    return (schema.minItems ?? 0) > 0 ? [initial(schema.items ?? {})] : [];
  if (schema.type === "boolean") return false;
  if (schema.type === "null") return null;
  if (schema.type === "number" || schema.type === "integer") return null;
  return "";
}

/** A property whose shape is not expressible as fields keeps one JSON control. */
function supportsFields(schema: PortSchema): boolean {
  if (schema.type === "object" && schema.properties !== undefined) return true;
  if (schema.oneOf || schema.anyOf) return false;
  if (schema.enum) return true;
  switch (schema.type) {
    case "string":
    case "number":
    case "integer":
    case "boolean":
      return true;
    case "array":
      return schema.items !== undefined && supportsFields(schema.items);
    default:
      return false;
  }
}

function InputValue({
  label,
  schema,
  value,
  onChange,
  disabled,
  root = false,
  onValidity,
}: {
  label: string;
  schema: PortSchema;
  value: Json | undefined;
  onChange: (value: Json) => void;
  disabled: boolean;
  root?: boolean;
  onValidity: (id: string, valid: boolean) => void;
}) {
  const name = nameOf(label);
  if (
    !supportsFields(schema) &&
    !(root && schema.type === "object" && !schema.oneOf && !schema.anyOf)
  )
    return (
      <JsonInput
        label={name}
        schema={schema}
        value={value}
        disabled={disabled}
        onChange={onChange}
        onValidity={onValidity}
      />
    );
  if (
    schema.type === "object" &&
    (schema.properties !== undefined || (!schema.oneOf && !schema.anyOf))
  ) {
    const object = S.is(S.JsonObject)(value) ? value : {};
    const fields = Object.entries(schema.properties ?? {}).map(
      ([key, child]) => (
        <InputValue
          key={key}
          label={key}
          schema={child}
          value={object[key]}
          disabled={disabled}
          onValidity={onValidity}
          onChange={(next) => {
            onChange(
              Object.fromEntries([...Object.entries(object), [key, next]]),
            );
          }}
        />
      ),
    );
    return root ? (
      <div className="grid gap-sm">{fields}</div>
    ) : (
      <FieldSet
        legend={name}
        description={schema.description}
        disabled={disabled}
      >
        {fields}
      </FieldSet>
    );
  }
  if (schema.type === "array") {
    const items = S.is(S.Array(S.Json))(value) ? value : [];
    const itemName = singular(name);
    return (
      <FieldSet
        legend={name}
        description={schema.description}
        disabled={disabled}
      >
        {items.map((item, index) => {
          const input = (
            <InputValue
              label={`${itemName} ${String(index + 1)}`}
              schema={schema.items ?? { type: "string" }}
              value={item}
              disabled={disabled}
              onValidity={onValidity}
              onChange={(next) => {
                onChange(items.map((old, i) => (i === index ? next : old)));
              }}
            />
          );
          const remove = (
            <Button
              type="button"
              variant="ghost-destructive"
              size="xs"
              disabled={items.length <= (schema.minItems ?? 0)}
              onClick={() => {
                onChange(items.filter((_, i) => i !== index));
              }}
            >
              Remove
            </Button>
          );
          return (
            <div key={index} className="flex items-end gap-xs">
              <div className="min-w-0 flex-1">{input}</div>
              {remove}
            </div>
          );
        })}
        <div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={items.length >= Math.min(schema.maxItems ?? 50, 50)}
            onClick={() => {
              onChange([...items, initial(schema.items ?? { type: "string" })]);
            }}
          >
            Add {itemName.toLowerCase()}
          </Button>
        </div>
      </FieldSet>
    );
  }
  if (schema.enum || schema.type === "boolean") {
    const choices = schema.enum ?? [true, false];
    return (
      <Field label={name} description={schema.description}>
        <Select
          aria-label={name}
          disabled={disabled}
          value={value === undefined ? "" : JSON.stringify(value)}
          onChange={(event) => {
            const selected = choices.find(
              (choice) => JSON.stringify(choice) === event.currentTarget.value,
            );
            if (selected !== undefined) onChange(selected);
          }}
        >
          <option value="">Choose…</option>
          {choices.map((choice) => (
            <option key={JSON.stringify(choice)} value={JSON.stringify(choice)}>
              {S.is(S.String)(choice) ? choice : JSON.stringify(choice)}
            </option>
          ))}
        </Select>
      </Field>
    );
  }
  const numeric = schema.type === "number" || schema.type === "integer";
  return (
    <Field label={name} description={schema.description}>
      <Input
        aria-label={name}
        disabled={disabled || schema.const !== undefined}
        type={numeric ? "number" : "text"}
        min={schema.minimum}
        max={schema.maximum}
        step={schema.type === "integer" ? 1 : "any"}
        minLength={schema.minLength}
        maxLength={schema.maxLength}
        value={S.is(S.Union([S.String, S.Number]))(value) ? value : ""}
        placeholder={
          schema.format === "fungi:file" ? "Computer file path" : undefined
        }
        onChange={(event) => {
          onChange(
            numeric
              ? Number.isFinite(event.currentTarget.valueAsNumber)
                ? event.currentTarget.valueAsNumber
                : null
              : event.currentTarget.value,
          );
        }}
      />
    </Field>
  );
}

/** Explain declared expectations; never expose the validator's schema machinery. */
function inputExpectation(schema: PortSchema, value: Json | undefined) {
  if (value === undefined) return "is required.";
  const expected = (item: Json) =>
    S.is(S.String)(item) ? item : JSON.stringify(item);
  if (schema.enum && !accepts({ enum: schema.enum }, value))
    return `must be one of ${schema.enum.map(expected).join(", ")}.`;
  if (schema.const !== undefined && !accepts({ const: schema.const }, value))
    return `must be ${expected(schema.const)}.`;
  if (schema.type && !accepts({ type: schema.type }, value)) {
    const names = {
      string: "text",
      number: "a number",
      integer: "a whole number",
      boolean: "yes or no",
      array: "a list",
      object: "a group of fields",
      null: "empty",
    };
    return `must be ${names[schema.type]}.`;
  }
  if (
    schema.minLength !== undefined &&
    !accepts({ minLength: schema.minLength }, value)
  )
    return `must contain at least ${String(schema.minLength)} ${schema.minLength === 1 ? "character" : "characters"}.`;
  if (
    schema.maxLength !== undefined &&
    !accepts({ maxLength: schema.maxLength }, value)
  )
    return `must contain no more than ${String(schema.maxLength)} ${schema.maxLength === 1 ? "character" : "characters"}.`;
  if (
    schema.minItems !== undefined &&
    !accepts({ minItems: schema.minItems }, value)
  )
    return `must contain at least ${String(schema.minItems)} ${schema.minItems === 1 ? "item" : "items"}.`;
  if (
    schema.maxItems !== undefined &&
    !accepts({ maxItems: schema.maxItems }, value)
  )
    return `must contain no more than ${String(schema.maxItems)} ${schema.maxItems === 1 ? "item" : "items"}.`;
  if (
    schema.minimum !== undefined &&
    !accepts({ minimum: schema.minimum }, value)
  )
    return `must be at least ${String(schema.minimum)}.`;
  if (
    schema.maximum !== undefined &&
    !accepts({ maximum: schema.maximum }, value)
  )
    return `must be no more than ${String(schema.maximum)}.`;
  if (
    schema.exclusiveMinimum !== undefined &&
    !accepts({ exclusiveMinimum: schema.exclusiveMinimum }, value)
  )
    return `must be greater than ${String(schema.exclusiveMinimum)}.`;
  if (
    schema.exclusiveMaximum !== undefined &&
    !accepts({ exclusiveMaximum: schema.exclusiveMaximum }, value)
  )
    return `must be less than ${String(schema.exclusiveMaximum)}.`;
  return "needs a valid value that matches this field's requirements.";
}

/** Index with the validator's own pointer encoder, then keep actionable leaf issues. */
function inputMessages(
  projection: PortSchema,
  raw: Json,
  issues: readonly { path: string }[],
) {
  const fields = new Map<
    string,
    {
      schema: PortSchema;
      value: Json | undefined;
      label: string;
      parents: readonly string[];
    }
  >();
  const visit = (
    schema: PortSchema,
    value: Json | undefined,
    path: string,
    words: readonly string[],
    parents: readonly string[],
  ) => {
    const first = words.at(0);
    const rest = words.slice(1);
    const label =
      first === undefined
        ? "Inputs"
        : nameOf(first) +
          (rest.length
            ? `: ${rest.map((word) => nameOf(word).toLowerCase()).join(" · ")}`
            : "");
    fields.set(path, { schema, value, label, parents });
    for (const [key, child] of Object.entries(schema.properties ?? {}))
      visit(
        child,
        S.is(S.JsonObject)(value) ? value[key] : undefined,
        `${path}/${encodePointer(key)}`,
        [...words, key],
        [...parents, path],
      );
    if (schema.items && S.is(S.Array(S.Json))(value))
      value.forEach((item, index) => {
        visit(
          schema.items ?? {},
          item,
          `${path}/${String(index)}`,
          [
            ...words,
            `${singular(words.at(-1) ?? "Item")} ${String(index + 1)}`,
          ],
          [...parents, path],
        );
      });
  };
  visit(projection, raw, "#", [], []);
  const affected = new Set<string>();
  for (const issue of issues) {
    const path = fields.has(issue.path) ? issue.path : "#";
    const field = fields.get(path);
    const missing = (field?.schema.required ?? []).filter(
      (key) =>
        S.is(S.JsonObject)(field?.value) && !Object.hasOwn(field.value, key),
    );
    if (missing.length)
      for (const key of missing) affected.add(`${path}/${encodePointer(key)}`);
    else affected.add(path);
  }
  return [...affected]
    .filter(
      (path) =>
        ![...affected].some(
          (other) =>
            other !== path && fields.get(other)?.parents.includes(path),
        ),
    )
    .map((path) => {
      const field = fields.get(path);
      return field
        ? `${field.label} ${inputExpectation(field.schema, field.value)}`
        : "Check the workflow's required input fields.";
    });
}

/** Caps owns form timing/errors; Braid owns projection and instance validation. */
export function workflowInputField(projection: PortSchema) {
  const properties = Object.values(projection.properties ?? {});
  const group = properties.length === 1 ? properties.at(0) : undefined;
  const singleGroup =
    group !== undefined &&
    ((group.type === "object" && group.properties !== undefined) ||
      (group.type === "array" &&
        group.items !== undefined &&
        supportsFields(group.items)));
  const definition = { input: S.decodeUnknownSync(S.JsonObject)(projection) };
  const schema = z
    .string()
    .transform((text, ctx) => {
      const parsed = S.decodeUnknownOption(S.fromJsonString(S.Json))(text);
      if (parsed._tag === "None") {
        ctx.addIssue({
          code: "custom",
          message:
            "Check the workflow inputs against their declared requirements.",
        });
        return z.NEVER;
      }
      const admitted = admitRunInput(definition, parsed.value);
      if (admitted.kind === "invalid") {
        for (const message of inputMessages(
          projection,
          parsed.value,
          admitted.issues,
        ))
          ctx.addIssue({
            code: "custom",
            message,
          });
        return z.NEVER;
      }
      return z.record(z.string(), z.json()).parse(admitted.input);
    })
    .meta(
      field<string>({
        label: singleGroup ? "" : "Inputs",
        render: (control) => (
          <InputFields schema={projection} control={control} />
        ),
      }),
    );
  return { schema, defaultValue: JSON.stringify(initial(projection)) };
}

/** Incomplete field JSON stays local and blocks submit; it cannot submit an older accepted value. */
function JsonInput({
  label,
  schema,
  value,
  disabled,
  onChange,
  onValidity,
}: {
  label: string;
  schema: PortSchema;
  value: Json | undefined;
  disabled: boolean;
  onChange: (value: Json) => void;
  onValidity: (id: string, valid: boolean) => void;
}) {
  const id = useId();
  const [text, setText] = useState(() =>
    JSON.stringify(value ?? null, null, 2),
  );
  const [error, setError] = useState(false);
  const latest = useRef(onValidity);
  latest.current = onValidity;
  useEffect(
    () => () => {
      latest.current(id, true);
    },
    [id],
  );
  return (
    <Field
      label={label}
      description={schema.description ?? "Enter a JSON value for this field."}
      error={error ? "Enter valid JSON before running." : undefined}
    >
      <Textarea
        aria-label={label}
        disabled={disabled}
        rows={3}
        value={text}
        onChange={(event) => {
          const next = event.currentTarget.value;
          setText(next);
          const parsed = S.decodeUnknownOption(S.fromJsonString(S.Json))(next);
          const valid = parsed._tag === "Some";
          setError(!valid);
          onValidity(id, valid);
          if (parsed._tag === "Some") onChange(parsed.value);
        }}
      />
    </Field>
  );
}

function InputFields({
  schema,
  control,
}: {
  schema: PortSchema;
  control: FieldRenderProps<string>;
}) {
  const [value, setValue] = useState(() =>
    S.decodeUnknownSync(S.fromJsonString(S.Json))(control.value),
  );
  const current = useRef(value);
  const invalid = useRef(new Set<string>());
  const emit = () => {
    control.onChange(
      invalid.current.size ? "" : JSON.stringify(current.current),
    );
  };
  return (
    <div
      id={control.id}
      role="group"
      aria-label={control.label || "Inputs"}
      aria-invalid={control["aria-invalid"]}
      aria-describedby={control["aria-describedby"]}
      onBlur={() => {
        control.onBlur();
      }}
    >
      <InputValue
        label="Inputs"
        root
        schema={schema}
        value={value}
        disabled={control.disabled}
        onValidity={(id, valid) => {
          if (valid) invalid.current.delete(id);
          else invalid.current.add(id);
          emit();
        }}
        onChange={(next) => {
          current.current = next;
          setValue(next);
          emit();
        }}
      />
    </div>
  );
}
