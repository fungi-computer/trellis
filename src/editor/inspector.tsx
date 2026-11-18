import { Field } from "@fungi.computer/caps/components/field";
import { Input } from "@fungi.computer/caps/components/input";
import { Select } from "@fungi.computer/caps/components/select";
import { Textarea } from "@fungi.computer/caps/components/textarea";
import {
  predicateSchema,
  mappingSchema,
  graphSchema,
  parseProjection,
  methodInputPorts,
  ports,
  type Catalog,
  type Issue,
  type Node,
  type PortRef,
} from "@fungi.computer/braid";
import * as S from "effect/Schema";
import { JsonField } from "./value-field.js";
import { MappingField } from "./mapping-field.js";
import type { Draft, DraftDocument } from "./draft-store.js";
import { methodFor, nodePorts } from "./graph.js";
import { TriggerFields } from "./trigger-fields.js";
import { InputFields, MappedOutputs } from "./input-fields.js";
import { CodeFields } from "./code-node.js";
import { StepPanel } from "./step-panel.js";
import {
  inputTitle,
  nodePresentation,
  nodeProblem,
} from "./graph-presentation.js";

import {
  graphDraft,
  replaceGraphDraft,
  type NodeAddress,
} from "./graph-address.js";

export function Inspector(props: {
  draft: Draft;
  catalog: Catalog;
  appDisplay?: DraftDocument["appDisplay"];
  selected: NodeAddress | null;
  issues: readonly Issue[];
  onChange: (draft: Draft) => void;
  onRemove: (address: NodeAddress) => void;
  onConnect: (graphId: string, from: PortRef, to: PortRef) => void;
}) {
  const graphId = props.selected?.graphId ?? "root";
  const scoped = graphDraft(props.draft, graphId);
  if (!scoped) return <p>The selected graph no longer exists.</p>;
  return (
    <ScopedInspector
      {...props}
      draft={scoped}
      selected={props.selected?.nodeId ?? null}
      issues={props.issues.filter(
        (issue) => (issue.graph ?? "root") === graphId,
      )}
      onChange={(next) => {
        props.onChange(replaceGraphDraft(props.draft, graphId, next));
      }}
      onRemove={(nodeId) => {
        props.onRemove({ graphId, nodeId });
      }}
      onConnect={(from, to) => {
        props.onConnect(graphId, from, to);
      }}
    />
  );
}

function ScopedInspector({
  draft,
  catalog,
  appDisplay,
  selected,
  issues,
  onChange,
  onRemove,
  onConnect,
}: {
  draft: Draft;
  catalog: Catalog;
  appDisplay?: DraftDocument["appDisplay"];
  selected: string | null;
  issues: readonly Issue[];
  onChange: (draft: Draft) => void;
  onRemove: (id: string) => void;
  onConnect: (from: PortRef, to: PortRef) => void;
}) {
  const node = draft.definition.nodes.find((item) => item.id === selected);

  const update = (next: Node) => {
    onChange({
      ...draft,
      definition: {
        ...draft.definition,
        nodes: draft.definition.nodes.map((item) =>
          item.id === next.id ? next : item,
        ),
      },
    });
  };
  const method = node ? methodFor(draft.definition, catalog, node) : undefined;
  if (!node)
    return (
      <div className="wf-pane-body">
        <Field label="Name">
          <Input
            value={draft.definition.title}
            maxLength={120}
            onChange={(event) => {
              onChange({
                ...draft,
                definition: {
                  ...draft.definition,
                  title: event.currentTarget.value,
                },
              });
            }}
          />
        </Field>
        <Field label="Description">
          <Textarea
            value={draft.definition.description ?? ""}
            maxLength={1000}
            onChange={(event) => {
              onChange({
                ...draft,
                definition: {
                  ...draft.definition,
                  description: event.currentTarget.value,
                },
              });
            }}
          />
        </Field>
        <InputFields
          value={draft.definition.input}
          onChange={(input) => {
            onChange({ ...draft, definition: { ...draft.definition, input } });
          }}
        />
        <MappedOutputs
          value={draft.definition.output}
          nodes={draft.definition.nodes}
        />
        <TriggerFields
          definition={draft.definition}
          catalog={catalog}
          appDisplay={appDisplay}
          onChange={(definition) => {
            onChange({ ...draft, definition });
          }}
        />
      </div>
    );
  const sources = [
    "$input",
    ...draft.definition.nodes
      .filter((item) => item.id !== selected)
      .map((item) => item.id),
  ].flatMap((id) =>
    Object.keys(nodePorts(draft.definition, catalog, id).outputs).map(
      (port) => ({ node: id, port }),
    ),
  );
  const inputs = method
    ? methodInputPorts(parseProjection(method.input))
    : undefined;
  const names = appDisplay ?? {};
  const titleOf = (step: Node) =>
    nodePresentation(draft.definition, catalog, step, names).title;
  const sourceName = (source: PortRef) => {
    const from = draft.definition.nodes.find((item) => item.id === source.node);
    return `${from ? titleOf(from) : source.node === "$input" ? inputTitle : source.node} · ${source.port}`;
  };
  const own = issues.filter((issue) => issue.node === node.id);
  const fieldPorts = new Set<string>(
    node.kind === "app" && inputs
      ? Object.keys(ports(inputs))
      : node.kind === "review"
        ? ["show"]
        : [],
  );
  /** A field's problem in the words of its status line: "Needs a path". */
  const problemOn = (port: string) => {
    const issue = own.find((item) => item.port === port);
    return issue ? nodeProblem([issue], node.id)?.words : undefined;
  };
  const presentation = nodePresentation(draft.definition, catalog, node, names);
  return (
    <StepPanel
      node={node}
      defaultTitle={presentation.title}
      meta={presentation.meta}
      problemCount={own.length}
      loose={own.filter(
        (issue) => issue.port === undefined || !fieldPorts.has(issue.port),
      )}
      onChange={update}
      onRemove={() => {
        onRemove(node.id);
      }}
    >
      {method ? (
        <p className="wf-muted">
          {method.description} · {method.effect} ·{" "}
          {method.approval === "queue"
            ? "Asks each time"
            : method.approval === "simulate"
              ? "Requires simulation"
              : "No extra approval"}
        </p>
      ) : null}
      {node.kind === "app" && inputs ? (
        Object.entries(ports(inputs)).map(([port, schema]) => {
          const feed = draft.definition.edges.find(
            (edge) => edge.to.node === node.id && edge.to.port === port,
          );
          const value = Object.hasOwn(node.values, port)
            ? node.values[port]
            : undefined;
          const problem = problemOn(port);
          return (
            <div key={port} data-problem={problem ? true : undefined}>
              <Field required={inputs.required?.includes(port)} error={problem}>
                <MappingField
                  key={`${node.id}.${port}`}
                  label={port}
                  schema={schema}
                  value={feed ? { from: feed.from } : value}
                  sources={sources}
                  sourceName={sourceName}
                  onChange={(next) => {
                    onChange({
                      ...draft,
                      definition: {
                        ...draft.definition,
                        edges: draft.definition.edges.filter(
                          (edge) => edge !== feed,
                        ),
                        nodes: draft.definition.nodes.map((item) =>
                          item.id === node.id
                            ? {
                                ...node,
                                values: { ...node.values, [port]: next },
                              }
                            : item,
                        ),
                      },
                    });
                  }}
                />
              </Field>
            </div>
          );
        })
      ) : node.kind === "review" ? (
        <>
          <div data-problem={problemOn("show") ? true : undefined}>
            <Field label="Show for review" error={problemOn("show")}>
              <Select
                value={
                  node.show[0]
                    ? `${node.show[0].node}.${node.show[0].port}`
                    : ""
                }
                onChange={(event) => {
                  const source = sources.find(
                    (ref) =>
                      `${ref.node}.${ref.port}` === event.currentTarget.value,
                  );
                  if (source)
                    onConnect(source, { node: node.id, port: "show" });
                }}
              >
                <option value="">Choose an output…</option>
                {sources.map((ref) => (
                  <option
                    key={`${ref.node}.${ref.port}`}
                    value={`${ref.node}.${ref.port}`}
                  >
                    {ref.node} · {ref.port}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <JsonField
            label="Review choices"
            value={node.choices ?? []}
            schema={S.Array(
              S.Struct({
                id: S.String,
                label: S.String,
                description: S.optionalKey(S.String),
              }),
            )}
            onChange={(choices) => {
              update({ ...node, choices });
            }}
          />
          <Field label="Review timeout (milliseconds)">
            <Input
              type="number"
              min={1}
              max={604800000}
              value={node.timeout}
              onChange={(event) => {
                const timeout = event.currentTarget.valueAsNumber;
                if (
                  Number.isInteger(timeout) &&
                  timeout >= 1 &&
                  timeout <= 604800000
                )
                  update({ ...node, timeout });
              }}
            />
          </Field>
          <Field label="Reviewers">
            <Select
              value={node.reviewers}
              onChange={(event) => {
                update({
                  ...node,
                  reviewers:
                    event.currentTarget.value === "owners"
                      ? "owners"
                      : "runner",
                });
              }}
            >
              <option value="runner">Person running the workflow</option>
              <option value="owners">Team owners</option>
            </Select>
          </Field>
        </>
      ) : (
        <ControlFields
          node={node}
          draft={draft}
          sources={sources}
          onChange={update}
        />
      )}
      {(node.kind === "map" || node.kind === "repeat") &&
      Object.hasOwn(draft.definition.subgraphs ?? {}, node.body) ? (
        <JsonField
          label={
            node.kind === "repeat" ? "Repeat body graph" : "Map body graph"
          }
          value={draft.definition.subgraphs?.[node.body]}
          schema={S.UndefinedOr(graphSchema)}
          onChange={(body) => {
            if (body)
              onChange({
                ...draft,
                definition: {
                  ...draft.definition,
                  subgraphs: {
                    ...draft.definition.subgraphs,
                    [node.body]: body,
                  },
                },
              });
          }}
        />
      ) : null}
    </StepPanel>
  );
}

function ControlFields({
  node,
  draft,
  sources,
  onChange,
}: {
  node: Node;
  draft: Draft;
  sources: readonly PortRef[];
  onChange: (node: Node) => void;
}) {
  switch (node.kind) {
    case "code":
      return <CodeFields node={node} onChange={onChange} />;
    case "wait":
      return (
        <Field label="Wait (milliseconds)">
          <Input
            type="number"
            min={1}
            max={604800000}
            value={node.for}
            onChange={(event) => {
              const value = event.currentTarget.valueAsNumber;
              if (Number.isInteger(value) && value > 0 && value <= 604800000)
                onChange({ ...node, for: value });
            }}
          />
        </Field>
      );
    case "condition":
      return (
        <JsonField
          label="Condition"
          value={node.test}
          schema={predicateSchema}
          onChange={(test) => {
            onChange({ ...node, test });
          }}
        />
      );
    case "transform":
      return (
        <JsonField
          label="Output mappings"
          value={node.fields}
          schema={S.Record(S.String, mappingSchema)}
          onChange={(fields) => {
            onChange({ ...node, fields });
          }}
        />
      );
    case "repeat":
      return (
        <>
          <Field label="Maximum rounds">
            <Input
              type="number"
              min={1}
              max={5}
              value={node.maxRounds}
              onChange={(event) => {
                const maxRounds = event.currentTarget.valueAsNumber;
                if (
                  Number.isInteger(maxRounds) &&
                  maxRounds >= 1 &&
                  maxRounds <= 5
                )
                  onChange({ ...node, maxRounds });
              }}
            />
          </Field>
          <JsonField
            label="Stop when"
            value={node.until}
            schema={predicateSchema}
            onChange={(until) => {
              onChange({ ...node, until });
            }}
          />
          <Field label="Body graph">
            <Select
              value={node.body}
              onChange={(event) => {
                onChange({ ...node, body: event.currentTarget.value });
              }}
            >
              {Object.keys(draft.definition.subgraphs ?? {}).map((id) => (
                <option key={id} value={id}>
                  {id}
                </option>
              ))}
            </Select>
          </Field>
        </>
      );
    case "map":
      return (
        <>
          <Field label="List to map">
            <Select
              value={`${node.over.node}.${node.over.port}`}
              onChange={(event) => {
                const over = sources.find(
                  (ref) =>
                    `${ref.node}.${ref.port}` === event.currentTarget.value,
                );
                if (over) onChange({ ...node, over });
              }}
            >
              <option value="">Choose a list…</option>
              {sources.map((ref) => (
                <option
                  key={`${ref.node}.${ref.port}`}
                  value={`${ref.node}.${ref.port}`}
                >
                  {ref.node} · {ref.port}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Body">
            <Select
              value={node.body}
              onChange={(event) => {
                onChange({ ...node, body: event.currentTarget.value });
              }}
            >
              {Object.keys(draft.definition.subgraphs ?? {}).map((name) => (
                <option key={name}>{name}</option>
              ))}
            </Select>
          </Field>
          <Field label="Concurrency">
            <Input
              type="number"
              min={1}
              max={8}
              value={node.concurrency}
              onChange={(event) => {
                const concurrency = event.currentTarget.valueAsNumber;
                if (
                  Number.isInteger(concurrency) &&
                  concurrency >= 1 &&
                  concurrency <= 8
                )
                  onChange({ ...node, concurrency });
              }}
            />
          </Field>
          <Field label="Maximum items">
            <Input
              type="number"
              min={1}
              max={50}
              value={node.maxItems}
              onChange={(event) => {
                const maxItems = event.currentTarget.valueAsNumber;
                if (
                  Number.isInteger(maxItems) &&
                  maxItems >= 1 &&
                  maxItems <= 50
                )
                  onChange({ ...node, maxItems });
              }}
            />
          </Field>
        </>
      );
    case "app":
      return (
        <p role="alert">
          This App method is no longer in the installed catalog.
        </p>
      );
    case "review":
      return null;
  }
}
