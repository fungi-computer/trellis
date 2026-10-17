import { useCatalogLoading } from "./catalog-loading.js";
import { Button } from "@fungi.computer/caps/components/button";
import type { NodeAddress } from "./graph-address.js";
import { GraphResults, nodeResultsFor } from "./graph-results.js";
import { nodePorts } from "./graph.js";
import type { RunStep } from "../runs/run-state.js";
import type { ReadMedia } from "../runs/review-dock.js";
import type { Catalog, Node, WorkflowDefinition } from "@fungi.computer/braid";
import {
  bodyDefinition,
  bodySteps,
  conditionBranches,
  nodePresentation,
} from "./graph-presentation.js";
import type { DraftDocument } from "./draft-store.js";

/** Maps own subgraphs; conditions expose their declared true/false successors. */
export function GraphBody({
  onSelect,
  definition,
  catalog,
  appDisplay,
  node,
  seen = new Set<string>(),
  nodeResults = [],
  readMedia,
  graphId,
}: {
  onSelect: (address: NodeAddress) => void;
  definition: WorkflowDefinition;
  catalog: Catalog;
  appDisplay: DraftDocument["appDisplay"];
  node: Node;
  seen?: ReadonlySet<string>;
  nodeResults?: readonly RunStep[];
  readMedia?: ReadMedia;
  graphId?: string;
}) {
  const loading = useCatalogLoading();
  const body = bodyDefinition(definition, node);
  const key =
    node.kind === "map" || node.kind === "repeat"
      ? `body:${node.body}`
      : `node:${node.id}`;
  if (seen.has(key))
    return (
      <p className="wf-node-purpose">
        Fix the recursive graph to show its body.
      </p>
    );
  const visited = new Set([...seen, key]);
  if (body) {
    return (
      <section
        className="wf-body"
        aria-label={node.kind === "repeat" ? "Repeat body" : "Map body"}
      >
        <h3>
          {node.kind === "repeat"
            ? `Up to ${String(node.maxRounds)} rounds`
            : "For each item"}
        </h3>
        <ol>
          {bodySteps(body).map((step) => {
            const presentation = nodePresentation(
              body,
              catalog,
              step,
              appDisplay,
              loading,
            );
            return (
              <li key={step.id} className="wf-body-step">
                <h4>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="nodrag nopan"
                    onClick={(event) => {
                      event.stopPropagation();
                      if (node.kind === "map" || node.kind === "repeat")
                        onSelect({ graphId: node.body, nodeId: step.id });
                    }}
                  >
                    {presentation.title}
                  </Button>
                </h4>
                <p className="wf-node-purpose" title={presentation.purpose}>
                  {presentation.purpose}
                </p>
                <GraphResults
                  results={nodeResultsFor(
                    nodeResults,
                    step.id,
                    node.kind === "map" || node.kind === "repeat"
                      ? node.body
                      : graphId,
                  )}
                  outputs={nodePorts(body, catalog, step.id).outputs}
                  readMedia={readMedia}
                />
                <GraphBody
                  onSelect={onSelect}
                  definition={body}
                  catalog={catalog}
                  appDisplay={appDisplay}
                  node={step}
                  seen={visited}
                  nodeResults={nodeResults}
                  readMedia={readMedia}
                  graphId={
                    node.kind === "map" || node.kind === "repeat"
                      ? node.body
                      : graphId
                  }
                />
              </li>
            );
          })}
        </ol>
        {body.nodes.some((step) => step.kind === "transform") ? (
          <details>
            <summary>Values and connections</summary>
            {body.nodes
              .filter((step) => step.kind === "transform")
              .map((step) => (
                <Button
                  key={step.id}
                  variant="ghost"
                  size="sm"
                  className="nodrag nopan"
                  onClick={(event) => {
                    event.stopPropagation();
                    if (node.kind === "map" || node.kind === "repeat")
                      onSelect({ graphId: node.body, nodeId: step.id });
                  }}
                >
                  {
                    nodePresentation(body, catalog, step, appDisplay, loading)
                      .title
                  }
                </Button>
              ))}
          </details>
        ) : null}
      </section>
    );
  }
  if (node.kind !== "condition") return null;
  const branches = conditionBranches(definition, node);
  return (
    <section className="wf-body" aria-label="Condition branches">
      <h3>Choose a branch</h3>
      {(["true", "false"] as const).map((branch) => (
        <div key={branch} className="wf-body-step">
          <h4>{branch === "true" ? "When true" : "When false"}</h4>
          {bodySteps({ ...definition, nodes: branches[branch] }).map(
            (target) => {
              const presentation = nodePresentation(
                definition,
                catalog,
                target,
                appDisplay,
                loading,
              );
              return (
                <div key={target.id}>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="nodrag nopan"
                    onClick={(event) => {
                      event.stopPropagation();
                      onSelect({
                        graphId: graphId ?? "root",
                        nodeId: target.id,
                      });
                    }}
                  >
                    {presentation.title}
                  </Button>
                  <p className="wf-node-purpose" title={presentation.purpose}>
                    {presentation.purpose}
                  </p>
                  <GraphResults
                    results={nodeResultsFor(nodeResults, target.id, graphId)}
                    outputs={nodePorts(definition, catalog, target.id).outputs}
                    readMedia={readMedia}
                  />
                  <GraphBody
                    onSelect={onSelect}
                    definition={definition}
                    catalog={catalog}
                    appDisplay={appDisplay}
                    node={target}
                    seen={visited}
                    nodeResults={nodeResults}
                    readMedia={readMedia}
                    graphId={graphId}
                  />
                </div>
              );
            },
          )}
          {branches[branch].length === 0 ? (
            <p>
              {definition.edges.some(
                (edge) =>
                  edge.from.node === node.id && edge.from.port === branch,
              )
                ? "Choose a valid destination."
                : "Skip"}
            </p>
          ) : null}
        </div>
      ))}
    </section>
  );
}
