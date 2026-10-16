import { useEffect, useRef, useState } from "react";
import * as S from "effect/Schema";
import {
  projectionSchema,
  type JsonSchemaProjection,
  type PortRef,
  type Node,
} from "@fungi.computer/braid";
import { Button } from "@fungi.computer/caps/components/button";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@fungi.computer/caps/components/card";
import { Field, FieldSet } from "@fungi.computer/caps/components/field";
import { Input } from "@fungi.computer/caps/components/input";
import { Textarea } from "@fungi.computer/caps/components/textarea";
import { Select } from "@fungi.computer/caps/components/select";
import { Checkbox } from "@fungi.computer/caps/components/checkbox";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@fungi.computer/caps/components/dropdown-menu";
import { DataList, DataRow } from "@fungi.computer/caps/components/data-list";
import { JsonField } from "./value-field.js";

const names = (value: string) =>
  value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/^./, (letter) => letter.toUpperCase());
const typeLabels = new Map([
  ["string", "Text"],
  ["number", "Number"],
  ["integer", "Whole number"],
  ["boolean", "Yes or no"],
  ["array", "List"],
  ["object", "Object"],
]);
const types = [...typeLabels.keys()];

/** Edits the schema itself; running and validation remain owned by Braid. */
export function InputFields({
  value,
  onChange,
  legend = "Workflow inputs",
}: {
  legend?: string;
  value: JsonSchemaProjection;
  onChange: (value: JsonSchemaProjection) => void;
}) {
  const propertySchema = S.Record(S.String, S.JsonObject);
  const editable =
    value.type === "object" &&
    (!Object.hasOwn(value, "properties") ||
      S.is(propertySchema)(value.properties)) &&
    (!Object.hasOwn(value, "required") ||
      S.is(S.Array(S.String))(value.required));
  const properties = S.is(propertySchema)(value.properties)
    ? S.decodeUnknownSync(propertySchema)(value.properties)
    : {};
  const required: readonly string[] = S.is(S.Array(S.String))(value.required)
    ? S.decodeUnknownSync(S.Array(S.String))(value.required)
    : [];
  const [expanded, setExpanded] = useState<string | null>(
    Object.keys(properties).at(0) ?? null,
  );
  const [json, setJson] = useState(false);
  const update = (
    entries: [string, JsonSchemaProjection][],
    nextRequired: readonly string[] = required,
  ) => {
    onChange({
      ...value,
      type: "object",
      properties: Object.fromEntries(entries),
      required: nextRequired,
    });
  };
  return (
    <FieldSet
      legend={
        <span className="flex flex-wrap items-center justify-between gap-xs">
          <span>{legend}</span>
          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label={`${legend} options`}
              render={<Button variant="ghost" size="xs" />}
            >
              Options
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem
                onSelect={() => {
                  setJson(!json);
                }}
              >
                {json ? "Edit fields" : "Edit as JSON"}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </span>
      }
    >
      {json ? (
        <JsonField
          label="Input schema"
          value={value}
          schema={projectionSchema}
          onChange={onChange}
        />
      ) : !editable ? (
        <p>This input uses a custom schema. Use Options to edit it as JSON.</p>
      ) : (
        <>
          {Object.entries(properties).map(([name, field], index) => (
            <InputField
              key={index}
              name={name}
              index={index}
              expanded={expanded === name}
              onToggle={() => {
                setExpanded(expanded === name ? null : name);
              }}
              value={field}
              required={required.includes(name)}
              onChange={(next) => {
                update(
                  Object.entries(properties).map(([key, item]) => [
                    key,
                    key === name ? next : item,
                  ]),
                );
              }}
              onRename={(next) => {
                if (!next.trim()) return "Enter a field name.";
                if (next === name) return null;
                if (next !== name && Object.hasOwn(properties, next))
                  return "This name is already used.";
                setExpanded(next);
                update(
                  Object.entries(properties).map(([key, item]) => [
                    key === name ? next : key,
                    item,
                  ]),
                  required.map((key) => (key === name ? next : key)),
                );
                return null;
              }}
              onRequired={(checked) => {
                update(
                  Object.entries(properties),
                  checked
                    ? [...required.filter((key) => key !== name), name]
                    : required.filter((key) => key !== name),
                );
              }}
              onRemove={() => {
                update(
                  Object.entries(properties).filter(([key]) => key !== name),
                  required.filter((key) => key !== name),
                );
              }}
            />
          ))}
          <div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                let number = Object.keys(properties).length + 1;
                while (Object.hasOwn(properties, `input${String(number)}`))
                  number++;
                setExpanded(`input${String(number)}`);
                update([
                  ...Object.entries(properties),
                  [`input${String(number)}`, { type: "string" }],
                ]);
              }}
            >
              Add input
            </Button>
          </div>
        </>
      )}
    </FieldSet>
  );
}

function InputField({
  name,
  index,
  expanded,
  onToggle,
  value,
  required,
  onChange,
  onRename,
  onRequired,
  onRemove,
}: {
  name: string;
  index: number;
  expanded: boolean;
  onToggle: () => void;
  value: JsonSchemaProjection;
  required: boolean;
  onChange: (value: JsonSchemaProjection) => void;
  onRename: (name: string) => string | null;
  onRequired: (required: boolean) => void;
  onRemove: () => void;
}) {
  const [draftName, setDraftName] = useState(name);
  const [nameError, setNameError] = useState<string | null>(null);
  const [enumError, setEnumError] = useState<string | null>(null);
  const [json, setJson] = useState(false);
  const label = names(name);
  const type = S.is(S.String)(value.type) ? value.type : "";
  const description = S.is(S.String)(value.description)
    ? value.description
    : "";
  const enumValues = S.is(S.Array(S.Json))(value.enum) ? value.enum : [];
  const [options, setOptions] = useState(enumValues.map(String).join("\n"));
  const previousName = useRef(name);
  useEffect(() => {
    if (previousName.current === name) return;
    previousName.current = name;
    setDraftName(name);
    setNameError(null);
    setEnumError(null);
    setJson(false);
    setOptions(
      S.is(S.Array(S.Json))(value.enum)
        ? value.enum.map(String).join("\n")
        : "",
    );
  }, [name, value]);
  return (
    <Card className="@container">
      <CardHeader className="flex flex-row flex-wrap items-start justify-between">
        <div className="min-w-0 flex-1 basis-full @sm:basis-40">
          <CardTitle>{label}</CardTitle>
          <CardDescription>
            {typeLabels.get(type) ?? "Custom schema"} ·{" "}
            {required ? "Required" : "Optional"}
          </CardDescription>
        </div>
        <div className="flex flex-wrap items-center gap-xs">
          <Button
            variant="ghost"
            size="xs"
            aria-label={`Edit input ${name}`}
            aria-expanded={expanded}
            onClick={onToggle}
          >
            {expanded ? "Close" : "Edit"}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label={`${label} options`}
              render={<Button variant="ghost" size="xs" />}
            >
              Options
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem
                onSelect={() => {
                  if (!expanded) onToggle();
                  setJson(!json);
                }}
              >
                {json ? "Edit fields" : "Edit as JSON"}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            variant="ghost"
            size="xs"
            aria-label={`Remove input ${name}`}
            onClick={onRemove}
          >
            Remove
          </Button>
        </div>
      </CardHeader>
      {expanded ? (
        <CardContent>
          {json ? (
            <JsonField
              label={`${label} schema`}
              value={value}
              schema={projectionSchema}
              onChange={(next) => {
                setOptions(
                  S.is(S.Array(S.Json))(next.enum)
                    ? next.enum.map(String).join("\n")
                    : "",
                );
                onChange(next);
              }}
            />
          ) : (
            <>
              <Field label="Name" error={nameError ?? undefined}>
                <Input
                  aria-label={`Input ${String(index + 1)} name`}
                  value={draftName}
                  onChange={(event) => {
                    setDraftName(event.currentTarget.value);
                  }}
                  onBlur={() => {
                    setNameError(onRename(draftName));
                  }}
                />
              </Field>
              <Field label="Type">
                <Select
                  aria-label={`${label} type`}
                  value={type}
                  onChange={(event) => {
                    const next = event.currentTarget.value;
                    setOptions("");
                    let schema: JsonSchemaProjection = { type: next };
                    if (description) schema = { ...schema, description };
                    if (next === "object") {
                      onChange({
                        ...schema,
                        properties: {},
                        required: [],
                        additionalProperties: false,
                      });
                    } else if (next === "array") {
                      onChange({ ...schema, items: { type: "string" } });
                    } else {
                      onChange(schema);
                    }
                  }}
                >
                  <option value="" disabled>
                    Custom schema
                  </option>
                  {types.map((item) => (
                    <option key={item} value={item}>
                      {typeLabels.get(item)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field>
                <label className="flex items-center gap-xs">
                  <Checkbox
                    aria-label={`${label} required`}
                    checked={required}
                    onChange={(event) => {
                      onRequired(event.currentTarget.checked);
                    }}
                  />
                  Required
                </label>
              </Field>
              {type === "string" || type === "number" || type === "integer" ? (
                <Field
                  label="Choices"
                  error={enumError ?? undefined}
                  description="One per line. Leave empty to allow any value."
                >
                  <Textarea
                    aria-label={`${label} choices`}
                    rows={3}
                    value={options}
                    onChange={(event) => {
                      const text = event.currentTarget.value;
                      setOptions(text);
                      const lines = text
                        .split(/\r?\n/)
                        .map((line) => line.trim())
                        .filter(Boolean);
                      const values =
                        type === "string" ? lines : lines.map(Number);
                      if (
                        values.some(
                          (item) =>
                            type !== "string" &&
                            (!S.is(S.Number)(item) ||
                              !Number.isFinite(item) ||
                              (type === "integer" && !Number.isInteger(item))),
                        ) ||
                        new Set<string | number>(values).size !== values.length
                      ) {
                        setEnumError(
                          "Enter distinct options of the selected type.",
                        );
                        return;
                      }
                      setEnumError(null);
                      const { enum: previous, ...rest } = value;
                      void previous;
                      onChange(
                        values.length ? { ...rest, enum: values } : rest,
                      );
                    }}
                  />
                </Field>
              ) : null}
              <Field
                label="Description"
                description="Help text shown with the input."
              >
                <Input
                  aria-label={`${label} description`}
                  value={description}
                  onChange={(event) => {
                    onChange({
                      ...value,
                      description: event.currentTarget.value,
                    });
                  }}
                />
              </Field>
              {type === "object" ? (
                <InputFields
                  legend={`${label} fields`}
                  value={value}
                  onChange={onChange}
                />
              ) : null}
              {type === "array" ? (
                <Field label="Item type">
                  <Select
                    aria-label={`${label} item type`}
                    value={
                      S.is(S.JsonObject)(value.items) &&
                      S.is(S.String)(value.items.type)
                        ? value.items.type
                        : ""
                    }
                    onChange={(event) => {
                      onChange({
                        ...value,
                        items: { type: event.currentTarget.value },
                      });
                    }}
                  >
                    <option value="" disabled>
                      Custom schema
                    </option>
                    {types.map((item) => (
                      <option key={item} value={item}>
                        {typeLabels.get(item)}
                      </option>
                    ))}
                  </Select>
                </Field>
              ) : null}
            </>
          )}
        </CardContent>
      ) : null}
    </Card>
  );
}

/** Output mappings are authored by the graph; this panel only explains them. */
export function MappedOutputs({
  value,
  nodes,
}: {
  value: Readonly<Record<string, PortRef>>;
  nodes: readonly Node[];
}) {
  const titles = new Map(
    nodes.map((node) => [
      node.id,
      "title" in node ? node.title : names(node.id),
    ]),
  );
  return (
    <FieldSet legend="Workflow outputs">
      <DataList aria-label="Mapped workflow outputs">
        {Object.entries(value).map(([name, ref]) => (
          <DataRow key={name}>
            <strong>{names(name)}</strong>
            <span>
              {" "}
              · from{" "}
              {titles.get(ref.node) ??
                (ref.node === "$input"
                  ? "Workflow input"
                  : `Missing node ${ref.node}`)}{" "}
              ({ref.port})
            </span>
          </DataRow>
        ))}
      </DataList>
      {Object.keys(value).length ? null : <p>No outputs mapped yet.</p>}
    </FieldSet>
  );
}
