import { useCatalogLoading } from "./catalog-loading.js";
import * as S from "effect/Schema";
import {
  GraphResults,
  iterationProgress,
  nodeResultsFor,
} from "./graph-results.js";
import type { ReadMedia } from "../runs/output-preview.js";
import type { RunStep } from "../runs/run-state.js";
import {
  displayEdges,
  inputMeta,
  inputTitle,
  loopSummary,
  nodePresentation,
  nodeProblem,
  portPresentation,
} from "./graph-presentation.js";
import "./graph-presentation.css";
import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { Badge } from "@fungi.computer/caps/components/badge";
import { IconButton } from "@fungi.computer/caps/components/icon-button";
import { Maximize, ZoomIn, ZoomOut } from "lucide-react";
import { WorkflowMark } from "./mark.js";
import { Surface } from "@fungi.computer/caps/components/surface";
import {
  useNodesInitialized,
  useConnection,
  useUpdateNodeInternals,
  useReactFlow,
  useStore,
  Background,
  getViewportForBounds,
  Handle,
  MiniMap,
  Panel,
  Position,
  ReactFlow,
  type Node as FlowNode,
  type NodeProps,
} from "@xyflow/react";
import { connect, nodePorts } from "./graph.js";
import { handleSides, placeNodes, type Size } from "./canvas-layout.js";
import { isFlowPin, pinToken, pinWords } from "./pins.js";
import type { Draft, DraftDocument } from "./draft-store.js";
import type { Frames } from "@fungi.computer/workflows-wire";
import type {
  Catalog,
  Issue,
  PortRef,
  PortSchema,
  Node,
} from "@fungi.computer/braid";

import { NodeStatus, nodeStateWords } from "../runs/node-status.js";
import type { NodeState } from "../runs/run-state.js";

import type { NodeAddress } from "./graph-address.js";

/*
 * The canvas contract. Later slices drive the canvas through these props and
 * never reach into it: search at a point, a wire let go over empty space, a
 * wire the types refuse, marks on steps, comment frames and which graph shows.
 */

/** A place on the canvas, in screen pixels (to anchor a popover) and in flow units (to place a step). */
export type CanvasPoint = {
  readonly client: { readonly x: number; readonly y: number };
  readonly flow: { readonly x: number; readonly y: number };
};
/** What a person or an Agent did to a step since the live version. */
export type NodeMark = "added" | "changed" | "removed";
/** A comment frame behind a group of steps. It never enters the workflow definition. */
export type CanvasFrame = Frames[number];

const markWords = {
  added: "Added",
  changed: "Changed",
  removed: "Removed",
} as const;
const markTones = {
  added: "success",
  changed: "warning",
  removed: "error",
} as const;
const sides = {
  left: Position.Left,
  right: Position.Right,
  top: Position.Top,
  bottom: Position.Bottom,
} as const;
/** The "Add a step" button sits over the canvas's top corner; steps start below it. */
const addStepInset = 56;
const addStepInsetPx = "56px";
const fitPadding = {
  top: addStepInsetPx,
  right: 0.04,
  bottom: 0.04,
  left: 0.04,
} as const;
const minZoom = 0.25;
const maxZoom = 1.5;
/** Below this zoom a whole graph is unreadable, so it opens at its first step instead. */
const readableZoom = 0.65;

type CardData = {
  connectedInputs: readonly string[];
  connectedOutputs: readonly string[];
  results: readonly RunStep[];
  readMedia?: ReadMedia;
  state?: NodeState;
  /** The state is the draft's last run, not a run on show. */
  lastRun?: boolean;
  title: string;
  meta: string;
  kind: string;
  node?: Node;
  appIcon?: string;
  appName?: string;
  inputs: Readonly<Record<string, PortSchema>>;
  outputs: Readonly<Record<string, PortSchema>>;
  problem?: ReturnType<typeof nodeProblem>;
  mark?: NodeMark;
  loop?: string;
};
type Card = FlowNode<CardData, "workflow">;
type FrameData = { label: string; tone: CanvasFrame["tone"] };
type FrameCardNode = FlowNode<FrameData, "frame">;
type CanvasNode = Card | FrameCardNode;

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
  const where = handleSides();
  const visible = (side: "inputs" | "outputs") =>
    Object.entries(data[side]).filter(([key, schema]) => {
      // Order pins stay out of the way until wired or a wire is being dragged.
      const control =
        data.node !== undefined && isFlowPin(data.node, side, key, schema);
      const connected =
        side === "inputs" ? data.connectedInputs : data.connectedOutputs;
      return !control || connecting || connected.includes(key);
    });
  const progress = data.loop ? iterationProgress(data.results) : undefined;
  const status = data.problem ? (
    <NodeStatus state="problem" label={data.problem.words} />
  ) : data.state ? (
    <NodeStatus
      state={data.state}
      label={
        data.lastRun
          ? `Last run: ${nodeStateWords[data.state]}`
          : nodeStateWords[data.state]
      }
    />
  ) : null;
  return (
    <Surface
      placement="embedded"
      size="sm"
      className="wf-node"
      data-selected={selected || undefined}
      data-problem={data.problem ? true : undefined}
      data-mark={data.mark}
    >
      <header className="wf-node-head">
        <WorkflowMark
          kind={data.kind}
          appIcon={data.appIcon}
          appName={data.appName}
        />
        <span className="wf-node-title">{data.title}</span>
        <span className="wf-node-meta" title={data.meta}>
          {data.meta}
        </span>
        {data.mark ? (
          <Badge size="sm" tone={markTones[data.mark]} className="wf-node-mark">
            {markWords[data.mark]}
          </Badge>
        ) : null}
      </header>
      {data.node?.kind === "transform"
        ? Object.entries(data.node.fields).flatMap(([key, mapping]) =>
            "literal" in mapping
              ? [
                  <p key={key} className="wf-node-value">
                    <strong>{portPresentation(key, {}).label}:</strong>{" "}
                    {S.is(S.String)(mapping.literal)
                      ? mapping.literal
                      : JSON.stringify(mapping.literal)}
                  </p>,
                ]
              : [],
          )
        : null}
      {data.loop ? (
        <p className="wf-node-loop" title="Double-click to open">
          {data.loop}
        </p>
      ) : null}
      <div className="wf-ports">
        {(["inputs", "outputs"] as const).map((side) => (
          <ul key={side} className="wf-port-col" aria-label={side}>
            {visible(side).map(([key, schema]) => {
              const token = pinToken(data.node, side, key, schema);
              const { label, help } = portPresentation(key, schema);
              return (
                <li
                  key={key}
                  className="wf-port"
                  data-port={key}
                  data-side={side === "inputs" ? "in" : "out"}
                  title={help}
                >
                  <Handle
                    type={side === "inputs" ? "target" : "source"}
                    position={
                      sides[side === "inputs" ? where.input : where.output]
                    }
                    id={key}
                    className="wf-handle"
                    data-pin={token}
                    data-problem={
                      data.problem?.ports.has(key) ? true : undefined
                    }
                    aria-label={`${label}, ${pinWords[token].toLowerCase()}`}
                  />
                  <span>{label}</span>
                </li>
              );
            })}
          </ul>
        ))}
      </div>
      {data.loop ? null : (
        <GraphResults
          results={data.results}
          outputs={data.outputs}
          readMedia={data.readMedia}
          showIterations={data.results.length > 1}
        />
      )}
      {status || progress ? (
        <footer className="wf-node-status">
          {status}
          {progress ? (
            <span className="wf-node-progress">
              {String(progress.done)} of {String(progress.total)}
            </span>
          ) : null}
        </footer>
      ) : null}
    </Surface>
  );
}

/** Zoom out, zoom in and fit: three Caps icon buttons at the bottom left. */
function CanvasControls() {
  const { zoomIn, zoomOut, fitView } = useReactFlow();
  const zoom = useStore((store) => store.transform[2]);
  return (
    <Panel position="bottom-left" className="wf-canvas-controls">
      <IconButton
        aria-label="Zoom out"
        size="sm"
        variant="outline"
        icon={<ZoomOut />}
        disabled={zoom <= minZoom}
        onClick={() => {
          void zoomOut();
        }}
      />
      <IconButton
        aria-label="Zoom in"
        size="sm"
        variant="outline"
        icon={<ZoomIn />}
        disabled={zoom >= maxZoom}
        onClick={() => {
          void zoomIn();
        }}
      />
      <IconButton
        aria-label="Fit to screen"
        size="sm"
        variant="outline"
        icon={<Maximize />}
        onClick={() => {
          void fitView({ padding: fitPadding, minZoom, maxZoom });
        }}
      />
    </Panel>
  );
}

function FrameCard({ data }: NodeProps<FrameCardNode>) {
  return (
    <div className="wf-frame" data-tone={data.tone}>
      <span className="wf-frame-label">{data.label}</span>
    </div>
  );
}
const nodeTypes = { workflow: NodeCard, frame: FrameCard };

export function WorkflowCanvas({
  readOnly = false,
  graphId = "root",
  nodeStates,
  nodeResults = [],
  nodeMarks,
  frames,
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
  onSearch,
  onPinRelease,
  onPinMismatch,
  onEnter,
}: {
  readOnly?: boolean;
  /** The graph on show: `root`, or a loop's body once a person can enter it. */
  graphId?: string;
  nodeStates?: Readonly<Record<string, NodeState>>;
  nodeResults?: readonly RunStep[];
  /** Added, changed or removed since the live version, by step id. */
  nodeMarks?: Readonly<Record<string, NodeMark>>;
  /** Comment frames; only those of this `graphId` draw. */
  frames?: readonly CanvasFrame[];
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
  /** Tab, a right-click or a double-click on empty canvas asks to add a step here. */
  onSearch?: (point: CanvasPoint) => void;
  /** A wire dragged off an output pin and let go over empty canvas. */
  onPinRelease?: (from: PortRef, point: CanvasPoint) => void;
  /**
   * A wire the types refuse. When given, the canvas checks every wire with
   * `connect()` and calls this instead of `onConnect` for a refused one.
   */
  onPinMismatch?: (from: PortRef, to: PortRef, point: CanvasPoint) => void;
  /** A person opened a loop; `body` is the graph id to show next. */
  onEnter?: (body: string) => void;
}) {
  const [edgeSelection, setEdgeSelection] = useState<ReadonlySet<string>>(
    new Set(),
  );
  const [selection, setSelection] = useState<ReadonlySet<string>>(new Set());
  const [measurements, setMeasurements] = useState<
    Partial<Record<string, Size>>
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
  const wrapper = useRef<HTMLDivElement>(null);
  const pointer = useRef<{ x: number; y: number } | null>(null);
  const initialized = useNodesInitialized();
  const loading = useCatalogLoading();
  const {
    fitView,
    getNodes,
    getNodesBounds,
    screenToFlowPosition,
    setViewport,
  } = useReactFlow();
  const paneWidth = useStore((store) => store.width);
  const paneHeight = useStore((store) => store.height);
  const nodeCount = draft.definition.nodes.length;
  useEffect(() => {
    if (!initialized || narrow) return;
    const frame = requestAnimationFrame(() => {
      // Frames count too, so the whole picture sits in the middle of the pane.
      const all = getNodes();
      const shown = all.filter((node) => node.type === "workflow");
      if (!shown.length) return;
      const fit = getViewportForBounds(
        getNodesBounds(all),
        paneWidth,
        paneHeight,
        minZoom,
        maxZoom,
        0.04,
      );
      if (fit.zoom >= readableZoom)
        void fitView({ padding: fitPadding, minZoom, maxZoom, nodes: all });
      else {
        // Too wide to read at once: start at the first step, not the middle.
        const first = shown.find((node) => node.id === "$input") ?? shown[0];
        void setViewport({
          x: 16 - first.position.x,
          y: 16 - first.position.y,
          zoom: 1,
        });
      }
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
  const placed = placeNodes(draft.definition, draft.layout, measurements);
  const portsById = new Map(
    ["$input", ...draft.definition.nodes.map((node) => node.id)].map((id) => [
      id,
      nodePorts(draft.definition, catalog, id),
    ]),
  );
  let narrowTop = 0;
  const steps: Card[] = [
    {
      id: "$input",
      title: inputTitle,
      kind: "input",
      meta: inputMeta,
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
  ].map((node) => {
    const top = narrowTop;
    narrowTop += (measurements[node.id]?.height ?? 136) + 24;
    const own = issues.filter(
      (issue) =>
        issue.node === node.id ||
        ((node.node?.kind === "map" || node.node?.kind === "repeat") &&
          issue.graph === node.node.body),
    );
    return {
      id: node.id,
      type: "workflow",
      measured: measurements[node.id],
      position: narrow
        ? { x: 0, y: top }
        : (placed.get(node.id) ?? { x: 0, y: 0 }),
      selected: selection.size
        ? selection.has(node.id)
        : selected?.graphId === graphId && node.id === selected.nodeId,
      deletable: node.id !== "$input",
      data: {
        connectedInputs: connectionEdges
          .filter((edge) => edge.to.node === node.id)
          .map((edge) => edge.to.port),
        connectedOutputs: connectionEdges
          .filter((edge) => edge.from.node === node.id)
          .map((edge) => edge.from.port),
        state:
          node.id === "$input"
            ? undefined
            : (nodeResultsFor(nodeResults, node.id).at(-1)?.state ??
              nodeStates?.[node.id]),
        lastRun:
          node.id !== "$input" &&
          nodeResultsFor(nodeResults, node.id).length === 0 &&
          nodeStates?.[node.id] !== undefined,
        results: nodeResultsFor(nodeResults, node.id),
        readMedia,
        title: node.title,
        meta: node.meta,
        kind: node.kind,
        node: node.node,
        appIcon: node.appIcon,
        appName: node.appName,
        ...(portsById.get(node.id) ?? { inputs: {}, outputs: {} }),
        problem: nodeProblem(own, node.id),
        mark: nodeMarks?.[node.id],
        loop:
          node.node?.kind === "map" || node.node?.kind === "repeat"
            ? loopSummary(draft.definition, node.node)
            : undefined,
      },
    };
  });
  const frameNodes: FrameCardNode[] = (frames ?? [])
    .filter((frame) => frame.graph === graphId)
    .map((frame) => ({
      id: `frame:${frame.id}`,
      type: "frame",
      position: { x: frame.x, y: frame.y },
      width: frame.width,
      height: frame.height,
      draggable: false,
      selectable: false,
      focusable: false,
      connectable: false,
      deletable: false,
      zIndex: -1,
      data: { label: frame.label, tone: frame.tone },
    }));
  const nodes: CanvasNode[] = [...frameNodes, ...steps];
  const tokenOf = (ref: PortRef, side: "inputs" | "outputs") =>
    pinToken(
      draft.definition.nodes.find((item) => item.id === ref.node),
      side,
      ref.port,
      portsById.get(ref.node)?.[side][ref.port] ?? {},
    );
  const edges = connectionEdges.map((edge) => ({
    id: edge.id,
    source: edge.from.node,
    sourceHandle: edge.from.port,
    target: edge.to.node,
    targetHandle: edge.to.port,
    type: narrow ? "smoothstep" : "default",
    pathOptions: { offset: 8 },
    className: `wf-wire wf-wire-${tokenOf(edge.from, "outputs")}`,
  }));
  const centre = () => {
    const box = wrapper.current?.getBoundingClientRect();
    return box
      ? { x: box.left + box.width / 2, y: box.top + box.height / 2 }
      : { x: 0, y: 0 };
  };
  const pointAt = (client: { x: number; y: number }): CanvasPoint => ({
    client,
    flow: screenToFlowPosition(client),
  });
  const search = (client: { x: number; y: number }) => {
    if (!readOnly) onSearch?.(pointAt(client));
  };
  const onPane = (event: ReactMouseEvent) =>
    event.target instanceof Element &&
    event.target.classList.contains("react-flow__pane");
  return (
    <div
      ref={wrapper}
      className="wf-canvas"
      role="group"
      aria-label="Workflow canvas"
      tabIndex={onSearch && !readOnly ? 0 : undefined}
      onPointerMove={(event) => {
        pointer.current = { x: event.clientX, y: event.clientY };
      }}
      onKeyDown={(event) => {
        // Tab on the canvas itself (or a step) opens search; elsewhere it moves focus on.
        if (event.key !== "Tab" || event.shiftKey || !onSearch || readOnly)
          return;
        const target = event.target;
        if (
          target !== event.currentTarget &&
          !(
            target instanceof Element &&
            target.classList.contains("react-flow__node")
          )
        )
          return;
        event.preventDefault();
        search(pointer.current ?? centre());
      }}
      onDoubleClick={(event) => {
        if (onPane(event)) search({ x: event.clientX, y: event.clientY });
      }}
    >
      <ReactFlow<CanvasNode>
        key={narrow ? "narrow" : "wide"}
        multiSelectionKeyCode="Control"
        nodesDraggable={!narrow && !readOnly}
        nodesConnectable={!readOnly}
        zoomOnDoubleClick={!onSearch || readOnly}
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
          onSelect({ graphId, nodeId: node.id });
        }}
        onNodeDoubleClick={(_, node) => {
          const step = draft.definition.nodes.find(
            (item) => item.id === node.id,
          );
          if (step?.kind === "map" || step?.kind === "repeat")
            onEnter?.(step.body);
        }}
        onPaneClick={() => {
          onSelect(null);
          setSelection(new Set());
        }}
        onPaneContextMenu={(event) => {
          if (!onSearch || readOnly) return;
          event.preventDefault();
          search({ x: event.clientX, y: event.clientY });
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
              if (change.selected) onSelect({ graphId, nodeId: change.id });
            }
          }
        }}
        onEdgesDelete={(deleted) => {
          for (const edge of deleted)
            if (/^\d+$/.test(edge.id)) onDisconnect(Number(edge.id));
        }}
        onConnect={(edge) => {
          if (!edge.sourceHandle || !edge.targetHandle) return;
          const from = { node: edge.source, port: edge.sourceHandle };
          const to = { node: edge.target, port: edge.targetHandle };
          if (onPinMismatch && !connect(draft, catalog, from, to).ok)
            onPinMismatch(from, to, pointAt(pointer.current ?? centre()));
          else onConnect(from, to);
        }}
        onConnectEnd={(event, connection) => {
          const { fromHandle, fromNode, toNode } = connection;
          if (
            readOnly ||
            !onPinRelease ||
            toNode ||
            !fromNode ||
            fromHandle.type !== "source" ||
            !fromHandle.id
          )
            return;
          const touch =
            "changedTouches" in event ? event.changedTouches[0] : event;
          onPinRelease(
            { node: fromNode.id, port: fromHandle.id },
            pointAt({ x: touch.clientX, y: touch.clientY }),
          );
        }}
        fitView={!narrow}
        defaultViewport={
          narrow ? { x: 16, y: addStepInset, zoom: 1 } : undefined
        }
        fitViewOptions={{ padding: fitPadding, minZoom, maxZoom }}
        minZoom={minZoom}
        maxZoom={maxZoom}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={24} size={1} />
        <CanvasControls />
        {narrow ? null : (
          <MiniMap
            pannable
            zoomable
            position="bottom-right"
            style={{ width: 180, height: 120 }}
            aria-label="Workflow overview"
            nodeClassName={(node) =>
              node.type === "frame" ? "wf-minimap-frame" : "wf-minimap-node"
            }
          />
        )}
      </ReactFlow>
    </div>
  );
}
