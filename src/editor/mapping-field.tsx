import { useId, useState } from "react";
import * as S from "effect/Schema";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@fungi.computer/caps/components/dropdown-menu";
import { Button } from "@fungi.computer/caps/components/button";
import {
  Card,
  CardHeader,
  CardContent,
} from "@fungi.computer/caps/components/card";
import { Field, FieldSet } from "@fungi.computer/caps/components/field";
import { Label } from "@fungi.computer/caps/components/label";
import { Input } from "@fungi.computer/caps/components/input";
import { Select } from "@fungi.computer/caps/components/select";
import {
  mappingSchema,
  type Mapping,
  type PortSchema,
  type PortRef,
} from "@fungi.computer/braid";
import { JsonField, ValueField } from "./value-field.js";

const fieldName = (key: string) => {
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
};
const itemName = (name: string) =>
  name.endsWith("ies")
    ? `${name.slice(0, -3)}y`
    : name.endsWith("s") && !name.endsWith("ss")
      ? name.slice(0, -1)
      : name;

/** Typed graph mappings composed with the ordinary Caps form controls. */
export function MappingField({
  label,
  schema,
  value,
  sources,
  onChange,
  jsonFallback = true,
  onRemove,
}: {
  label: string;
  schema: PortSchema;
  value: Mapping | undefined;
  sources: readonly PortRef[];
  onChange: (value: Mapping) => void;
  jsonFallback?: boolean;
  onRemove?: () => void;
}) {
  const id = useId();
  const [json, setJson] = useState(false);
  const name = fieldName(label);
  const group = schema.type === "object" || schema.type === "array";
  const mode =
    value && "from" in value
      ? "from"
      : value && "template" in value
        ? "template"
        : "literal";
  const expression =
    value &&
    !("literal" in value) &&
    !("object" in value) &&
    !("array" in value) &&
    (group || !("from" in value || "template" in value));
  const object: Readonly<Record<string, Mapping>> =
    value && "object" in value
      ? value.object
      : value && "literal" in value && S.is(S.JsonObject)(value.literal)
        ? Object.fromEntries(
            Object.entries(value.literal).map(([key, item]) => [
              key,
              { literal: item },
            ]),
          )
        : {};
  const array =
    value && "array" in value
      ? value.array
      : value && "literal" in value && S.is(S.Array(S.Json))(value.literal)
        ? value.literal.map((item) => ({ literal: item }))
        : [];
  const fallback = jsonFallback ? (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`${name} options`}
        render={<Button size="xs" variant="ghost" />}
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
  ) : null;
  const remove = onRemove ? (
    <Button size="xs" variant="ghost-destructive" onClick={onRemove}>
      Remove
    </Button>
  ) : null;
  function renderContent() {
    return json ? (
      <JsonField
        label={`${name} JSON`}
        value={value ?? { object: {} }}
        schema={mappingSchema}
        onChange={onChange}
      />
    ) : expression ? (
      <p>This group uses a mapping. Use Edit as JSON to change it.</p>
    ) : schema.type === "object" ? (
      schema.properties ? (
        Object.entries(schema.properties).map(([key, child]) => (
          <MappingField
            key={key}
            label={key}
            schema={child}
            value={object[key]}
            sources={sources}
            jsonFallback={false}
            onChange={(next) => {
              onChange({ object: { ...object, [key]: next } });
            }}
          />
        ))
      ) : (
        <p>No fields are declared. Use Edit as JSON to enter a value.</p>
      )
    ) : schema.type === "array" ? (
      <>
        {array.map((item, index) => {
          const title = `${itemName(name)} ${String(index + 1)}`;
          const removeItem = () => {
            onChange({
              array: array.filter((_, position) => position !== index),
            });
          };
          const field = (
            <MappingField
              label={title}
              schema={schema.items ?? {}}
              value={item}
              sources={sources}
              jsonFallback={false}
              onRemove={removeItem}
              onChange={(next) => {
                onChange({
                  array: array.map((old, position) =>
                    position === index ? next : old,
                  ),
                });
              }}
            />
          );
          return schema.items?.type === "object" ? (
            <div key={index}>{field}</div>
          ) : (
            <Card key={index} density="compact">
              <CardContent>{field}</CardContent>
            </Card>
          );
        })}
        <div>
          <Button
            size="sm"
            variant="outline"
            disabled={array.length >= Math.min(schema.maxItems ?? 50, 50)}
            onClick={() => {
              onChange({
                array: [
                  ...array,
                  schema.items?.type === "object"
                    ? { object: {} }
                    : { literal: schema.items?.default ?? "" },
                ],
              });
            }}
          >
            Add {itemName(name).toLowerCase()}
          </Button>
        </div>
      </>
    ) : value && "from" in value ? (
      <div className="grid gap-sm">
        <Field label="Output" description={schema.description}>
          <Select
            aria-label={`${name} output`}
            value={`${value.from.node}.${value.from.port}`}
            onChange={(event) => {
              const from = sources.find(
                (source) =>
                  `${source.node}.${source.port}` === event.currentTarget.value,
              );
              if (from) onChange({ ...value, from });
            }}
          >
            {sources.map((source) => (
              <option
                key={`${source.node}.${source.port}`}
                value={`${source.node}.${source.port}`}
              >
                {source.node} · {source.port}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Field path">
          <Input
            aria-label={`${name} field path`}
            placeholder="Optional JSON Pointer, e.g. /destination/path"
            maxLength={512}
            value={value.path ?? ""}
            onChange={(event) => {
              if (event.currentTarget.value) {
                onChange({ from: value.from, path: event.currentTarget.value });
              } else {
                onChange({ from: value.from });
              }
            }}
          />
        </Field>
      </div>
    ) : value === undefined || "literal" in value || "template" in value ? (
      <ValueField
        key={mode}
        id={id}
        label={name}
        schema={schema}
        value={value}
        onChange={onChange}
      />
    ) : (
      <p>Use Edit as JSON to change this mapping.</p>
    );
  }
  if (schema.type === "object")
    return (
      <Card density="compact" role="group" aria-label={name}>
        <CardHeader className="flex flex-row items-center justify-between gap-sm">
          <Label>{name}</Label>
          <div className="flex items-center gap-sm">
            {remove}
            {fallback}
          </div>
        </CardHeader>
        <CardContent>
          <FieldSet
            legend={<span className="sr-only">{name}</span>}
            description={schema.description}
          >
            {renderContent()}
          </FieldSet>
        </CardContent>
      </Card>
    );
  if (schema.type === "array")
    return (
      <FieldSet legend={name} description={schema.description}>
        {fallback ? <div className="flex justify-end">{fallback}</div> : null}
        {renderContent()}
      </FieldSet>
    );
  return (
    <div className="grid gap-xs">
      <div className="flex items-center justify-between gap-sm">
        <Label htmlFor={id}>{name}</Label>
        <div className="w-28 shrink-0">
          <Select
            className="select-xs"
            aria-label={`${name} source`}
            value={mode}
            onChange={(event) => {
              switch (event.currentTarget.value) {
                case "from":
                  if (sources[0]) onChange({ from: sources[0] });
                  break;
                case "template":
                  onChange({
                    template:
                      value &&
                      "literal" in value &&
                      S.is(S.String)(value.literal)
                        ? value.literal
                        : "",
                  });
                  break;
                default:
                  onChange({
                    literal:
                      schema.default ?? (schema.type === "string" ? "" : null),
                  });
              }
            }}
          >
            <option value="literal">Fixed value</option>
            <option value="from" disabled={!sources.length}>
              From
            </option>
            <option value="template">Template</option>
          </Select>
        </div>
      </div>
      {renderContent()}
      {remove || fallback ? (
        <div className="flex items-center justify-end gap-sm">
          {remove}
          {fallback}
        </div>
      ) : null}
    </div>
  );
}
