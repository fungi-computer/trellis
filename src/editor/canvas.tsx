import { useCatalogLoading } from "./catalog-loading.js";
import { GraphResults, nodeResultsFor } from "./graph-results.js";
import type { ReadMedia } from "../runs/review-dock.js";
import type { RunStep } from "../runs/run-state.js";
import { GraphBody } from "./graph-body.js";
import {
  displayEdges,
  inputPurpose,
  nodePresentation,
} from "./graph-presentation.js";
import "./graph-presentation.css";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Badge } from "@fungi.computer/caps/components/badge";
import { WorkflowMark } from "./mark.js";
import { Surface } from "@fungi.computer/caps/components/surface";
import {
  useNodesInitialized,
  useConnection,
  useUpdateNodeInternals,
  useReactFlow,
  useStore,
  Background,
  Controls,
  Handle,
  Position,
  ReactFlow,
  type Node as FlowNode,
  type NodeProps,
} from "@xyflow/react";
import { nodePorts } from "./graph.js";
import type { Draft, DraftDocument } from "./draft-store.js";
import type {
  Catalog,
  Issue,
  PortRef,
  PortSchema,
  Node,
  WorkflowDefinition,
} from "@fungi.computer/braid";

import { NodeStatus } from "../runs/node-status.js";
import type { NodeState } from "../runs/run-state.js";

import type { NodeAddress } from "./graph-address.js";

type CardData = {
  connectedInputs: readonly string[];
  connectedOutputs: readonly string[];
  onSelect: (address: NodeAddress | null) => void;
  results: readonly RunStep[];
  nodeResults: readonly RunStep[];
  readMedia?: ReadMedia;
  state?: NodeState;
  title: string;
  kind: string;
  purpose: string;
  definition: WorkflowDefinition;
  catalog: Catalog;
  appDisplay: DraftDocument["appDisplay"];
  node?: Node;
  appIcon?: string;
  appName?: string;
  inputs: Readonly<Record<string, PortSchema>>;
  outputs: Readonly<Record<string, PortSchema>>;
  issues: readonly Issue[];
};
type Card = FlowNode<CardData, "workflow">;
function NodeCard({ data, selected, id }: NodeProps<Card>) {
  const connecting = useConnection((connection) => connection.inProgress);
  const updateInternals = useUpdateNodeInternals();
  const connections = JSON.stringify([
    data.connectedInputs,
    data.connectedOutputs,
  ]);
  const previous = useRef({ id, connecting, connections });
  useEffect(() => {
    const changed =
      previous.current.id !== id ||
      previous.current.connecting !== connecting ||
      previous.current.connections !== connections;
    previous.current = { id, connecting, connections };
    // React Flow measures initial nodes; refresh only dynamically changed handles.
    if (changed) updateInternals(id);
  }, [id, connecting, connections, updateInternals]);
  const visible = (side: "inputs" | "outputs") =>
    Object.entries(data[side]).filter(([key, schema]) => {
      const control =
        data.node !== undefined &&
        ((key === "after" && Object.keys(schema).length === 0) ||
          (side === "outputs" &&
            ((data.node.kind === "condition" &&
              (key === "true" || key === "false")) ||
              (data.node.kind === "review" &&
                (data.node.choices?.length
                  ? data.node.choices.some((choice) => choice.id === key)
                  : key === "approved" || key === "rejected")))));
      const connected =
        side === "inputs" ? data.connectedInputs : data.connectedOutputs;
      return !control || connecting || connected.includes(key);
    });
  return (
    <Surface
      placement="embedded"
      size="sm"
      className="wf-node"
      data-selected={selected || undefined}
      data-invalid={data.issues.length > 0 || undefined}
    >
      <header className="wf-node-head">
        <WorkflowMark
          kind={data.kind}
          appIcon={data.appIcon}
          appName={data.appName}
        />
        <span className="wf-node-title">{data.title}</span>
        {data.state ? <NodeStatus state={data.state} /> : null}
        {data.issues.length > 0 ? (
          <Badge size="sm" tone="error">
            !
          </Badge>
        ) : null}
      </header>
      <p className="wf-node-purpose" title={data.purpose}>
        {data.purpose}
      </p>
      <div className="wf-ports">
        {(["inputs", "outputs"] as const).map((side) => (
          <ul key={side} className="wf-port-col" aria-label={side}>
            {visible(side).map(([key, schema]) => (
              <li
                key={key}
                className="wf-port"
                data-port={key}
                data-side={side === "inputs" ? "in" : "out"}
              >
                <Handle
                  type={side === "inputs" ? "target" : "source"}
                  position={side === "inputs" ? Position.Left : Position.Right}
                  id={key}
                  className="wf-handle"
                />
                <span>{key}</span>
                <span className="wf-port-type">
                  {schema.format?.replace("fungi:", "") ??
                    schema.type ??
                    (key === "after" ? "signal" : "value")}
                </span>
              </li>
            ))}
          </ul>
        ))}
      </div>
      <GraphResults
        results={data.results}
        outputs={data.outputs}
        readMedia={data.readMedia}
        showIterations={data.results.length > 1}
      />
      {data.node ? (
        <GraphBody
          definition={data.definition}
          catalog={data.catalog}
          appDisplay={data.appDisplay}
          onSelect={data.onSelect}
          node={data.node}
          nodeResults={data.nodeResults}
          readMedia={data.readMedia}
        />
      ) : null}
    </Surface>
  );
}
const nodeTypes = { workflow: NodeCard };
export function WorkflowCanvas({
  readOnly = false,
  nodeStates,
  nodeResults = [],
  readMedia,
  draft,
  catalog,
  appDisplay,
  issues,
  selected,
  onSelect,
  onMove,
  onConnect,
  onRemove,
  onDisconnect,
  onDrop,
}: {
  readOnly?: boolean;
  nodeStates?: Readonly<Record<string, NodeState>>;
  nodeResults?: readonly RunStep[];
  readMedia?: ReadMedia;
  draft: Draft;
  catalog: Catalog;
  appDisplay: DraftDocument["appDisplay"];
  issues: readonly Issue[];
  selected: NodeAddress | null;
  onSelect: (address: NodeAddress | null) => void;
  onMove: (id: string, position: { x: number; y: number }) => void;
  onConnect: (from: PortRef, to: PortRef) => void;
  onRemove: (id: string) => void;
  onDisconnect: (index: number) => void;
  onDrop: (key: string, position: { x: number; y: number }) => void;
}) {
  const [edgeSelection, setEdgeSelection] = useState<ReadonlySet<string>>(
    new Set(),
  );
  const [selection, setSelection] = useState<ReadonlySet<string>>(new Set());
  const [measurements, setMeasurements] = useState<
    Partial<Record<string, { width: number; height: number }>>
  >({});
  const narrow = useSyncExternalStore(
    (changed) => {
      const media = window.matchMedia("(max-width: 720px)");
      media.addEventListener("change", changed);
      return () => {
        media.removeEventListener("change", changed);
      };
    },
    () => window.matchMedia("(max-width: 720px)").matches,
  );
  const initialized = useNodesInitialized();
  const loading = useCatalogLoading();
  const { fitView, getNodes, getNodesBounds, setViewport } = useReactFlow();
  const paneWidth = useStore((store) => store.width);
  const paneHeight = useStore((store) => store.height);
  const nodeCount = draft.definition.nodes.length;
  useEffect(() => {
    if (!initialized || narrow) return;
    const frame = requestAnimationFrame(() => {
      // A graph taller or wider than the pane starts at its first step, not its middle.
      const bounds = getNodesBounds(getNodes());
      if (bounds.width + 32 > paneWidth || bounds.height + 32 > paneHeight)
        void setViewport({ x: 16 - bounds.x, y: 16 - bounds.y, zoom: 1 });
      else void fitView({ padding: 0.08, minZoom: 1, maxZoom: 1 });
    });
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [
    initialized,
    nodeCount,
    fitView,
    getNodes,
    getNodesBounds,
    setViewport,
    paneWidth,
    paneHeight,
    narrow,
  ]);
  const connectionEdges = displayEdges(draft.definition, issues);
  let narrowTop = 0;
  const nodes: Card[] = [
    {
      id: "$input",
      title: "Workflow input",
      kind: "input",
      purpose: inputPurpose,
      node: undefined,
      appIcon: undefined,
      appName: undefined,
    },
    ...draft.definition.nodes.map((node) => ({
      id: node.id,
      kind: node.kind,
      appName:
        node.kind === "app"
          ? appDisplay[draft.definition.apps[node.app].appId]?.displayName
          : undefined,
      appIcon:
        node.kind === "app"
          ? appDisplay[draft.definition.apps[node.app].appId]?.icon
          : undefined,
      ...nodePresentation(draft.definition, catalog, node, appDisplay, loading),
      node,
    })),
  ].map((node, index) => {
    const top = narrowTop;
    narrowTop += (measurements[node.id]?.height ?? 136) + 24;
    return {
      id: node.id,
      type: "workflow",
      measured: measurements[node.id],
      position: narrow
        ? { x: 0, y: top }
        : (draft.layout[node.id] ?? { x: index * 280, y: 50 }),
      selected: selection.size
        ? selection.has(node.id)
        : selected?.graphId === "root" && node.id === selected.nodeId,
      deletable: node.id !== "$input",
      data: {
        connectedInputs: connectionEdges
          .filter((edge) => edge.to.node === node.id)
          .map((edge) => edge.to.port),
        connectedOutputs: connectionEdges
          .filter((edge) => edge.from.node === node.id)
          .map((edge) => edge.from.port),
        onSelect,
        state:
          node.id === "$input"
            ? undefined
            : (nodeResultsFor(nodeResults, node.id).at(-1)?.state ??
              nodeStates?.[node.id]),
        results: nodeResultsFor(nodeResults, node.id),
        nodeResults,
        readMedia,
        title: node.title,
        kind: node.kind,
        purpose: node.purpose,
        definition: draft.definition,
        catalog,
        appDisplay,
        node: node.node,
        appIcon: node.appIcon,
        appName: node.appName,
        ...nodePorts(draft.definition, catalog, node.id),
        issues: issues.filter(
          (issue) =>
            issue.node === node.id ||
            ((node.node?.kind === "map" || node.node?.kind === "repeat") &&
              issue.graph === node.node.body),
        ),
      },
    };
  });
  const edges = connectionEdges.map((edge) => ({
    id: edge.id,
    source: edge.from.node,
    sourceHandle: edge.from.port,
    target: edge.to.node,
    targetHandle: edge.to.port,
    type: narrow ? "smoothstep" : "default",
    pathOptions: { offset: 8 },
  }));
  return (
    <Surface
      depth="deep"
      className="wf-canvas"
      onDragOver={(event) => {
        event.preventDefault();
      }}
      onDrop={(event) => {
        event.preventDefault();
        if (readOnly) return;
        onDrop(event.dataTransfer.getData("application/x-fungi-node"), {
          x: event.clientX,
          y: event.clientY,
        });
      }}
    >
      <ReactFlow<Card>
        key={narrow ? "narrow" : "wide"}
        multiSelectionKeyCode="Control"
        nodesDraggable={!narrow && !readOnly}
        nodesConnectable={!readOnly}
        deleteKeyCode={readOnly ? null : ["Backspace", "Delete"]}
        nodes={nodes}
        edges={edges.map((edge) => ({
          ...edge,
          selected: edgeSelection.has(edge.id),
        }))}
        onEdgesChange={(changes) => {
          for (const change of changes)
            if (change.type === "select")
              setEdgeSelection((current) => {
                const next = new Set(current);
                if (change.selected) next.add(change.id);
                else next.delete(change.id);
                return next;
              });
        }}
        nodeTypes={nodeTypes}
        onNodeClick={(_, node) => {
          onSelect({ graphId: "root", nodeId: node.id });
        }}
        onPaneClick={() => {
          onSelect(null);
          setSelection(new Set());
        }}
        onNodesChange={(changes) => {
          for (const change of changes) {
            if (change.type === "dimensions" && change.dimensions) {
              const dimensions = change.dimensions;
              setMeasurements((current) =>
                current[change.id]?.width === dimensions.width &&
                current[change.id]?.height === dimensions.height
                  ? current
                  : { ...current, [change.id]: dimensions },
              );
            }
            if (change.type === "position" && change.position)
              onMove(change.id, change.position);
            if (change.type === "remove") onRemove(change.id);
            if (change.type === "select") {
              setSelection((current) => {
                const next = new Set(current);
                if (change.selected) next.add(change.id);
                else next.delete(change.id);
                return next;
              });
              if (change.selected)
                onSelect({ graphId: "root", nodeId: change.id });
            }
          }
        }}
        onEdgesDelete={(deleted) => {
          for (const edge of deleted)
            if (/^\d+$/.test(edge.id)) onDisconnect(Number(edge.id));
        }}
        onConnect={(edge) => {
          if (edge.sourceHandle && edge.targetHandle)
            onConnect(
              { node: edge.source, port: edge.sourceHandle },
              { node: edge.target, port: edge.targetHandle },
            );
        }}
        fitView={!narrow}
        defaultViewport={narrow ? { x: 16, y: 16, zoom: 1 } : undefined}
        fitViewOptions={{ padding: 0.08, minZoom: 1, maxZoom: 1 }}
        minZoom={1}
        maxZoom={1.5}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={24} size={1} />
        <Controls
          showInteractive={false}
          position="bottom-right"
          orientation="horizontal"
        />
      </ReactFlow>
    </Surface>
  );
}
