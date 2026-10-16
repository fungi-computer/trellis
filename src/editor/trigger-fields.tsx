import { useState } from "react";
import type { DraftDocument } from "./draft-store.js";
import * as S from "effect/Schema";
import { defineIdFamily } from "@fungi.computer/cairn/id";
import {
  Card,
  CardHeader,
  CardContent,
  CardTitle,
  CardDescription,
} from "@fungi.computer/caps/components/card";
import {
  Combobox,
  ComboboxTrigger,
} from "@fungi.computer/caps/components/combobox";
import { Button } from "@fungi.computer/caps/components/button";
import { Field, FieldSet } from "@fungi.computer/caps/components/field";
import { Input } from "@fungi.computer/caps/components/input";
import { Select } from "@fungi.computer/caps/components/select";
import {
  parseProjection,
  validate,
  TRIGGER_EVENT_PORTS,
  type Catalog,
  type WorkflowDefinition,
  type Predicate,
} from "@fungi.computer/braid";
import { eventLabel } from "../triggers/event-label.js";
import { scheduleChoices, scheduleSummary } from "../triggers/schedule.js";
import { MappingField } from "./mapping-field.js";
import { JsonField } from "./value-field.js";
import { predicateSchema } from "@fungi.computer/braid";

const triggerIds = defineIdFamily({
  family: "workflow-definition",
  version: 1,
  kinds: { trigger: { prefix: "workflow_trigger" } },
});

type Trigger = NonNullable<WorkflowDefinition["triggers"]>[number];

/** Editing a definition never arms it. Published controls belong to the Triggers view. */
export function TriggerFields({
  definition,
  catalog,
  appDisplay = {},
  onChange,
}: {
  definition: WorkflowDefinition;
  catalog: Catalog;
  appDisplay?: DraftDocument["appDisplay"];
  onChange: (definition: WorkflowDefinition) => void;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const triggers = definition.triggers ?? [];
  const events = Object.entries(definition.apps).flatMap(([alias, app]) =>
    Object.entries(
      new Map(Object.entries(catalog)).get(app.appId)?.events ?? {},
    ).map(([name, event]) => ({
      alias,
      appId: app.appId,
      name,
      event,
    })),
  );
  function appName(alias: string) {
    const app = new Map(Object.entries(definition.apps)).get(alias);
    return app ? (appDisplay[app.appId]?.displayName ?? app.appId) : alias;
  }
  const projection = inputProjection(definition);
  const inputs = projection?.properties ?? {};
  const issues = validate(definition, catalog).filter(
    (issue) => issue.trigger !== undefined,
  );
  function update(id: string, next: Trigger) {
    onChange({
      ...definition,
      triggers: triggers.map((trigger) => (trigger.id === id ? next : trigger)),
    });
  }
  function add(kind: "schedule" | "event") {
    const chosen = events.at(0);
    if (triggers.length >= 8 || (kind === "event" && !chosen)) return;
    const suffix = triggers.filter((trigger) => trigger.on === kind).length + 1;
    const id = triggerIds.trigger.generate();
    let trigger: Trigger;
    if (kind === "schedule")
      trigger = {
        id,
        on: "schedule",
        title: `Schedule ${String(suffix)}`,
        cron: {
          expression: "0 9 * * *",
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        },
        input: {},
      };
    else {
      if (!chosen) return;
      trigger = {
        id,
        on: "event",
        title: `App event ${String(suffix)}`,
        app: chosen.alias,
        event: chosen.name,
        eventDigest: chosen.event.digest,
        input: {},
      };
    }
    onChange({ ...definition, triggers: [...triggers, trigger] });
    setExpanded(id);
  }
  return (
    <FieldSet
      legend="Triggers"
      description="Publish changes, then arm them in Triggers."
    >
      {projection === null ? (
        <p role="alert">
          Fix the workflow input schema before mapping triggers.
        </p>
      ) : null}
      {triggers.map((trigger) => (
        <Card key={trigger.id} density="compact">
          <CardHeader>
            <div className="flex items-baseline justify-between gap-xs">
              <CardTitle className="min-w-0 flex-1">
                {trigger.title ?? trigger.id}
              </CardTitle>
              <div className="flex shrink-0 items-center gap-xs">
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  aria-label={`${expanded === trigger.id ? "Close" : "Edit"} ${trigger.title ?? trigger.id}`}
                  aria-expanded={expanded === trigger.id}
                  aria-controls={`trigger-settings-${trigger.id}`}
                  onClick={() => {
                    setExpanded(expanded === trigger.id ? null : trigger.id);
                  }}
                >
                  {expanded === trigger.id ? "Close" : "Edit"}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  aria-label={`Remove trigger ${trigger.title ?? trigger.id}`}
                  onClick={() => {
                    onChange({
                      ...definition,
                      triggers: triggers.filter(
                        (item) => item.id !== trigger.id,
                      ),
                    });
                    if (expanded === trigger.id) setExpanded(null);
                  }}
                >
                  Remove trigger
                </Button>
              </div>
            </div>
            <CardDescription>
              {trigger.on === "schedule"
                ? scheduleSummary(trigger.cron)
                : trigger.on === "event"
                  ? `${appName(trigger.app)} · ${eventLabel(trigger.event)}`
                  : "Webhook"}
            </CardDescription>
          </CardHeader>
          {expanded === trigger.id ? (
            <CardContent id={`trigger-settings-${trigger.id}`}>
              <FieldSet legend="Trigger settings">
                <Field label="Title">
                  <Input
                    maxLength={120}
                    value={trigger.title ?? ""}
                    onChange={(event) => {
                      update(trigger.id, {
                        ...trigger,
                        title: event.currentTarget.value,
                      });
                    }}
                  />
                </Field>
                {trigger.on === "schedule" ? (
                  <>
                    <SchedulePicker
                      expression={trigger.cron.expression}
                      onChange={(expression) => {
                        update(trigger.id, {
                          ...trigger,
                          cron: { ...trigger.cron, expression },
                        });
                      }}
                    />
                    <Field
                      label="Time zone"
                      description="Search for the time zone this schedule uses."
                    >
                      <Combobox
                        items={[
                          ...new Set([
                            trigger.cron.timeZone,
                            "UTC",
                            ...Intl.supportedValuesOf("timeZone"),
                          ]),
                        ]}
                        getKey={(zone) => zone}
                        getLabel={(zone) => zone}
                        value={trigger.cron.timeZone}
                        trigger={
                          <ComboboxTrigger aria-label="Time zone">
                            {trigger.cron.timeZone}
                          </ComboboxTrigger>
                        }
                        inputProps={{
                          "aria-label": "Search time zones",
                          placeholder: "Search time zones",
                        }}
                        onValueChange={(timeZone) => {
                          if (timeZone)
                            update(trigger.id, {
                              ...trigger,
                              cron: { ...trigger.cron, timeZone },
                            });
                        }}
                      />
                    </Field>
                  </>
                ) : trigger.on === "event" ? (
                  <Field
                    label="App event"
                    description={
                      events.find(
                        (item) =>
                          item.alias === trigger.app &&
                          item.name === trigger.event,
                      )?.event.description
                    }
                  >
                    <Select
                      value={JSON.stringify([trigger.app, trigger.event])}
                      onChange={(event) => {
                        const chosen = events.find(
                          (item) =>
                            JSON.stringify([item.alias, item.name]) ===
                            event.currentTarget.value,
                        );
                        if (chosen)
                          update(trigger.id, {
                            ...trigger,
                            app: chosen.alias,
                            event: chosen.name,
                            eventDigest: chosen.event.digest,
                          });
                      }}
                    >
                      {!events.some(
                        (item) =>
                          item.alias === trigger.app &&
                          item.name === trigger.event,
                      ) ? (
                        <option
                          value={JSON.stringify([trigger.app, trigger.event])}
                        >
                          Unavailable · {trigger.app} · {trigger.event}
                        </option>
                      ) : null}
                      {events.map((item) => (
                        <option
                          key={JSON.stringify([item.alias, item.name])}
                          value={JSON.stringify([item.alias, item.name])}
                        >
                          {appDisplay[item.appId]?.displayName ?? item.appId} ·{" "}
                          {eventLabel(item.name)}
                        </option>
                      ))}
                    </Select>
                  </Field>
                ) : (
                  <p>Webhook triggers are not available yet.</p>
                )}
                {trigger.on === "event" ? (
                  <FilterFields
                    value={trigger.when}
                    onChange={(when) => {
                      if (when) update(trigger.id, { ...trigger, when });
                      else {
                        const { when: removed, ...rest } = trigger;
                        void removed;
                        update(trigger.id, rest);
                      }
                    }}
                  />
                ) : null}
                <FieldSet
                  legend="Run inputs"
                  description="Map this trigger's event fields onto the workflow inputs."
                >
                  {Object.entries(inputs).map(([name, schema]) => (
                    <MappingField
                      key={name}
                      label={name}
                      schema={schema}
                      value={trigger.input?.[name]}
                      sources={TRIGGER_EVENT_PORTS[trigger.on].map((port) => ({
                        node: "$input",
                        port,
                      }))}
                      onChange={(value) => {
                        update(trigger.id, {
                          ...trigger,
                          input: { ...trigger.input, [name]: value },
                        });
                      }}
                    />
                  ))}
                </FieldSet>
                {issues
                  .filter((issue) => issue.trigger === trigger.id)
                  .map((issue, index) => (
                    <p role="alert" key={index}>
                      {issue.port ? `${issue.port}: ` : ""}
                      {issue.message}
                    </p>
                  ))}
              </FieldSet>
            </CardContent>
          ) : null}
        </Card>
      ))}
      <div className="flex flex-wrap gap-xs">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={triggers.length >= 8}
          onClick={() => {
            add("schedule");
          }}
        >
          Add schedule
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={triggers.length >= 8 || events.length === 0}
          onClick={() => {
            add("event");
          }}
        >
          Add App event
        </Button>
      </div>
      {!events.length ? (
        <p className="wf-muted">
          No App events are declared in the current catalog.
        </p>
      ) : null}
    </FieldSet>
  );
}

function FilterFields({
  value,
  onChange,
}: {
  value: Predicate | undefined;
  onChange: (value: Predicate | undefined) => void;
}) {
  const simple = value && "left" in value ? value : undefined;
  return (
    <FieldSet
      legend="Filter"
      description="Run only when this event matches. Leave the filter off to accept every event."
    >
      <Field label="Condition">
        <Select
          value={value ? (simple ? simple.op : "advanced") : "all"}
          onChange={(event) => {
            const op = event.currentTarget.value;
            if (op === "all") onChange(undefined);
            if (op === "eq" || op === "neq")
              onChange({
                op,
                left: simple?.left ?? {
                  from: { node: "$input", port: "payload" },
                },
                right: simple?.right ?? { literal: "" },
              });
          }}
        >
          <option value="all">Every event</option>
          <option value="eq">Equals</option>
          <option value="neq">Does not equal</option>
          {value && !simple ? (
            <option value="advanced">Advanced condition</option>
          ) : null}
        </Select>
      </Field>
      {simple ? (
        <>
          <MappingField
            label="Event field"
            schema={{ type: "string" }}
            value={simple.left}
            sources={[
              { node: "$input", port: "payload" },
              { node: "$input", port: "eventId" },
            ]}
            onChange={(left) => {
              onChange({ ...simple, left });
            }}
          />
          <MappingField
            label="Match value"
            schema={{ type: "string" }}
            value={simple.right}
            sources={[]}
            onChange={(right) => {
              onChange({ ...simple, right });
            }}
          />
        </>
      ) : value ? (
        <JsonField
          label="Advanced filter"
          value={value}
          schema={predicateSchema}
          onChange={onChange}
        />
      ) : null}
    </FieldSet>
  );
}

function inputProjection(definition: WorkflowDefinition) {
  try {
    return parseProjection(definition.input);
  } catch (cause) {
    if (!S.isSchemaError(cause)) throw cause;
    return null;
  }
}

function SchedulePicker({
  expression,
  onChange,
}: {
  expression: string;
  onChange: (expression: string) => void;
}) {
  const [custom, setCustom] = useState(false);
  const selected =
    custom ||
    !scheduleChoices.some((choice) => choice.expression === expression)
      ? "custom"
      : expression;
  return (
    <>
      <Field label="Frequency" description="Times use the time zone below.">
        <Select
          aria-label="Schedule frequency"
          value={selected}
          onChange={(event) => {
            const next = event.currentTarget.value;
            setCustom(next === "custom");
            if (next !== "custom") onChange(next);
          }}
        >
          {scheduleChoices.map((choice) => (
            <option key={choice.expression} value={choice.expression}>
              {choice.label}
            </option>
          ))}
          <option value="custom">Custom cron expression</option>
        </Select>
      </Field>
      {selected === "custom" ? (
        <Field
          label="Cron"
          description="Five-field cron expression, for example 0 9 * * * for 09:00 each day."
        >
          <Input
            aria-label="Custom cron expression"
            value={expression}
            maxLength={256}
            onChange={(event) => {
              onChange(event.currentTarget.value);
            }}
          />
        </Field>
      ) : null}
    </>
  );
}
