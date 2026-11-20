import { stepFollower } from "./follow-step.js";
import { useCatalogLoading } from "./catalog-loading.js";
import * as S from "effect/Schema";
import { GraphResults, nodeResultsIn } from "./graph-results.js";
import {
  FrameCard,
  framedSteps,
  frameAround,
  frameIdOf,
  frameNodeId,
  removeFrame,
  updateFrame,
  type Frame,
  type FrameBox,
  type FrameCardNode,
} from "./canvas-frames.js";
import { LoopBody } from "./loop-node.js";
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
import { Button } from "@fungi.computer/caps/components/button";
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
export type CanvasFrame = Frame;

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
/** The step a run is at: the one that failed, else waiting on a person, else running. */
function currentNode(states: Readonly<Record<string, NodeState>> | undefined) {
  const entries = Object.entries(states ?? {}).reverse();
  for (const state of ["failed", "waiting", "running"] as const) {
    const found = entries.find(([, at]) => at === state);
    if (found) return found[0];
  }
  return undefined;
}

/** Where the phone's column starts inside a loop: below the Back bar, which is 16px in and about 52px tall. */
const crumbClearance = 28;
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
  /** Opens the loop's body as its own graph. */
  enter?: () => void;
};
type Card = FlowNode<CardData, "workflow">;
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
        <LoopBody
          summary={data.loop}
          results={data.results}
          onEnter={data.enter}
        />
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
      {status ? <footer className="wf-node-status">{status}</footer> : null}
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

const nodeTypes = { workflow: NodeCard, frame: FrameCard };

export function WorkflowCanvas({
  readOnly = false,
  graphId = "root",
  nodeStates,
  nodeResults = [],
  nodeMarks,
  ghosts,
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
  onExit,
  crumb,
  onFramesChange,
}: {
  readOnly?: boolean;
  /** The graph on show: `root`, or a loop's body once a person can enter it. */
  graphId?: string;
  nodeStates?: Readonly<Record<string, NodeState>>;
  nodeResults?: readonly RunStep[];
  /** Added, changed or removed since the live version, by step id. */
  nodeMarks?: Readonly<Record<string, NodeMark>>;
  /**
   * Steps the draft dropped, drawn faded at their old place from the version
   * they were in. They have no pins, cannot be selected, moved or deleted.
   */
  ghosts?: Readonly<{
    draft: Draft;
    ids: readonly string[];
  }>;
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
  /** Leaves a loop's body for the graph it sits in (the Back button and Escape). */
  onExit?: () => void;
  /** The name of the loop this body belongs to, shown beside Back. */
  crumb?: string;
  /**
   * A person drew, labelled, coloured, moved, resized or deleted a frame:
   * the next `frames` for every graph. Without it frames are read-only.
   */
  onFramesChange?: (frames: CanvasFrame[]) => void;
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
  const [newFrame, setNewFrame] = useState<string | null>(null);
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
  const runAt = currentNode(nodeStates);
  const [follower] = useState(stepFollower);
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
        // Too wide to read at once. A run opens on the step it is at, with its
        // neighbours around it; a draft starts at its first step.
        const current = shown.find((node) => node.id === runAt);
        if (current !== undefined) {
          const view = follower.centre(
            { width: paneWidth, height: paneHeight },
            {
              ...current.position,
              width: current.measured?.width ?? 240,
              height: current.measured?.height ?? 136,
            },
            readableZoom,
          );
          if (view !== undefined) void setViewport(view);
          return;
        }
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
    runAt,
    follower,
  ]);
  const connectionEdges = displayEdges(draft.definition, issues);
  const placed = placeNodes(draft.definition, draft.layout, measurements);
  const portsById = new Map(
    ["$input", ...draft.definition.nodes.map((node) => node.id)].map((id) => [
      id,
      nodePorts(draft.definition, catalog, id),
    ]),
  );
  // Inside a loop the Back bar sits over the top of the column (16px in, about
  // 52px tall); start the first card a clear gap below it.
  let narrowTop = graphId !== "root" && onExit ? crumbClearance : 0;
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
    const loopBody =
      node.node?.kind === "map" || node.node?.kind === "repeat"
        ? node.node.body
        : undefined;
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
            : (nodeResultsIn(nodeResults, graphId, node.id).at(-1)?.state ??
              nodeStates?.[node.id]),
        lastRun:
          node.id !== "$input" &&
          nodeResultsIn(nodeResults, graphId, node.id).length === 0 &&
          nodeStates?.[node.id] !== undefined,
        results: nodeResultsIn(nodeResults, graphId, node.id),
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
        enter:
          onEnter && loopBody !== undefined
            ? () => {
                onEnter(loopBody);
              }
            : undefined,
      },
    };
  });
  const allFrames = frames ?? [];
  const framing = onFramesChange !== undefined && !readOnly && !narrow;
  const changeFrames = (next: readonly CanvasFrame[]) => {
    onFramesChange?.([...next]);
  };
  const frameNodes: FrameCardNode[] = allFrames
    // Frames sit at wide-layout places; the phone stacks cards in one column.
    .filter((frame) => !narrow && frame.graph === graphId)
    .map((frame) => ({
      id: frameNodeId(frame.id),
      type: "frame",
      position: { x: frame.x, y: frame.y },
      width: frame.width,
      height: frame.height,
      draggable: framing,
      selectable: framing,
      focusable: framing,
      connectable: false,
      deletable: framing,
      selected: selection.has(frameNodeId(frame.id)),
      zIndex: -1,
      data: {
        label: frame.label,
        tone: frame.tone,
        edit: framing
          ? {
              focus: newFrame === frame.id,
              onLabel: (label) => {
                changeFrames(updateFrame(allFrames, frame.id, { label }));
              },
              onTone: (tone) => {
                changeFrames(updateFrame(allFrames, frame.id, { tone }));
              },
              onRemove: () => {
                changeFrames(removeFrame(allFrames, frame.id));
              },
            }
          : undefined,
      },
    }));
  /** Each step's box in flow units: where it sits and what the card measured. */
  const stepBoxes: Record<string, FrameBox> = Object.fromEntries(
    steps.map((step) => [
      step.id,
      {
        x: step.position.x,
        y: step.position.y,
        width: measurements[step.id]?.width ?? 260,
        height: measurements[step.id]?.height ?? 136,
      },
    ]),
  );
  /** C: a frame around the selected steps, or a blank one at the pointer. */
  const drawFrame = () => {
    const chosen = selection.size
      ? [...selection].filter((id) => frameIdOf(id) === undefined)
      : selected?.graphId === graphId
        ? [selected.nodeId]
        : [];
    const frame = frameAround(
      allFrames,
      graphId,
      chosen.flatMap((id) => (id in stepBoxes ? [stepBoxes[id]] : [])),
      screenToFlowPosition(pointer.current ?? centre()),
    );
    if (!frame) return;
    changeFrames([...allFrames, frame]);
    setNewFrame(frame.id);
    setSelection(new Set([frameNodeId(frame.id)]));
  };
  const ghostPlaced =
    ghosts && graphId === "root"
      ? placeNodes(ghosts.draft.definition, ghosts.draft.layout, measurements)
      : null;
  const ghostSteps: Card[] =
    ghosts && ghostPlaced
      ? ghosts.ids.flatMap((id) => {
          const node = ghosts.draft.definition.nodes.find(
            (item) => item.id === id,
          );
          if (!node) return [];
          const top = narrowTop;
          narrowTop += (measurements[`ghost:${id}`]?.height ?? 136) + 24;
          const named = ghosts.draft.definition;
          const app = node.kind === "app" ? named.apps[node.app] : undefined;
          const shown = nodePresentation(
            named,
            catalog,
            node,
            appDisplay,
            loading,
          );
          return [
            {
              id: `ghost:${id}`,
              type: "workflow" as const,
              measured: measurements[`ghost:${id}`],
              position: narrow
                ? { x: 0, y: top }
                : (ghostPlaced.get(id) ?? { x: 0, y: 0 }),
              selected: false,
              selectable: false,
              draggable: false,
              deletable: false,
              connectable: false,
              focusable: false,
              data: {
                connectedInputs: [],
                connectedOutputs: [],
                results: [],
                title: shown.title,
                // The status chip says what happened; the step's own detail would
                // only be cut off beside it.
                meta: "",
                kind: node.kind,
                node,
                appIcon: app ? appDisplay[app.appId]?.icon : undefined,
                appName: app ? appDisplay[app.appId]?.displayName : undefined,
                inputs: {},
                outputs: {},
                mark: "removed" as const,
              },
            },
          ];
        })
      : [];
  const nodes: CanvasNode[] = [...frameNodes, ...steps, ...ghostSteps];
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
      tabIndex={(onSearch ?? onFramesChange) && !readOnly ? 0 : undefined}
      onPointerMove={(event) => {
        pointer.current = { x: event.clientX, y: event.clientY };
      }}
      onKeyDown={(event) => {
        const typing =
          event.target instanceof Element &&
          event.target.closest("input, textarea, select, [contenteditable]");
        if (typing) return;
        // C draws a frame, as in Unreal's blueprint editor; Escape leaves a loop's body.
        if (
          event.key.toLowerCase() === "c" &&
          !event.ctrlKey &&
          !event.metaKey &&
          !event.altKey &&
          framing
        ) {
          event.preventDefault();
          drawFrame();
          return;
        }
        if (event.key === "Escape" && graphId !== "root" && onExit) {
          onExit();
          return;
        }
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
          if (frameIdOf(node.id) === undefined)
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
          let nextFrames = allFrames;
          const moved = new Set(
            changes.flatMap((change) =>
              change.type === "position" ? [change.id] : [],
            ),
          );
          for (const change of changes) {
            const frameId = "id" in change ? frameIdOf(change.id) : undefined;
            if (frameId !== undefined) {
              const frame = nextFrames.find((item) => item.id === frameId);
              if (!frame) continue;
              if (change.type === "position" && change.position) {
                // The steps inside a frame travel with it.
                const dx = change.position.x - frame.x;
                const dy = change.position.y - frame.y;
                for (const id of framedSteps(frame, stepBoxes))
                  if (!moved.has(id))
                    onMove(id, {
                      x: stepBoxes[id].x + dx,
                      y: stepBoxes[id].y + dy,
                    });
                nextFrames = updateFrame(nextFrames, frameId, change.position);
              } else if (
                change.type === "dimensions" &&
                change.setAttributes &&
                change.dimensions
              )
                nextFrames = updateFrame(
                  nextFrames,
                  frameId,
                  change.dimensions,
                );
              else if (change.type === "remove")
                nextFrames = removeFrame(nextFrames, frameId);
              else if (change.type === "select")
                setSelection((current) => {
                  const next = new Set(current);
                  if (change.selected) next.add(change.id);
                  else next.delete(change.id);
                  return next;
                });
              continue;
            }
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
          if (nextFrames !== allFrames) changeFrames(nextFrames);
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
        // A person's own pan or zoom (it has an event) stops a run following its step.
        onMoveStart={(event) => {
          if (event !== null) follower.moved();
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
        {graphId !== "root" && onExit ? (
          <Panel position="top-left" className="wf-crumb">
            <Button size="xs" variant="ghost" onClick={onExit}>
              Back
            </Button>
            {crumb ? <span className="wf-crumb-title">{crumb}</span> : null}
          </Panel>
        ) : null}
        {narrow ? null : (
          <MiniMap
            pannable
            zoomable
            position="bottom-right"
            style={{ width: 180, height: 120 }}
            aria-label="Workflow overview"
            nodeClassName={(node) => {
              if (node.type === "frame") return "wf-minimap-frame";
              const state = nodeStates?.[node.id];
              // A run's minimap sets the step it is at apart from the rest.
              return state === "failed" ||
                state === "waiting" ||
                state === "running"
                ? `wf-minimap-node wf-minimap-${state}`
                : "wf-minimap-node";
            }}
          />
        )}
      </ReactFlow>
    </div>
  );
}
